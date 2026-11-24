#!/usr/bin/env python3
"""Telegram bloggers for the crowd gauge: new posts of the public channels in leaders.json ("telegram").

Called from crowd.py every run (hourly). Reads Telegram's own public web preview of each channel, https://t.me/s/<channel>,
the page anyone can open without an account: no bot, no login, no paid API. From it we take the channel's name, avatar,
subscribers, the views of its recent posts and the posts themselves (text, time, views). Forwarded posts are skipped:
only what the author writes counts.

A post's calls are read by Claude (calls_of(); env ANTHROPIC_API_KEY), because most of these bloggers write in Russian
or Ukrainian: only the author's own short-term call on an asset we track, kept only when its quote is really in the post.
Without the key, English posts are tagged by crowd.tag() and other posts are skipped. Each post is read once:
the newest post id per channel is kept in the state (tg_last).

A channel counts only when the preview answers for exactly that handle with MIN_SUBS subscribers AND a median of MIN_VIEWS
views on its recent posts: big Telegram channels often have bought subscribers, and the views show who really reads them.
"""
import html as H, json, os, re, statistics, time, urllib.error, urllib.request
from datetime import datetime

UA = {"User-Agent": "Mozilla/5.0 (compatible; Freekonomist/1.0; +https://freekonomist.com)"}
MIN_SUBS = 30000
MIN_VIEWS = 2000
FIRST = 5 * 86400    # how far back the first read of a new channel goes: hourly prices cover 7 days, so its calls can still be checked
PAGES = 3            # preview pages per channel per run (about 20 posts each)
PAGES_FIRST = 8      # ... and on the first read of a new channel
MODEL = "claude-haiku-5-5"
MAX_READ = 120       # posts read by Claude per run
MAX_READ_NEW = 500   # ... when a channel is read for the first time (a new batch of channels is read within a run or two)

# asset ids of crowd.ASSET_RE, named for the model
NAMES = {"btc": "Bitcoin", "eth": "Ethereum", "sol": "Solana", "xrp": "XRP", "bnb": "BNB", "doge": "Dogecoin", "ton": "Toncoin",
         "sui": "Sui", "gold": "gold", "silver": "silver", "brent": "crude oil (Brent/WTI)", "spx": "S&P 500 / US stock market", "ndx": "Nasdaq 100",
         "dxy": "US dollar index", "nvda": "Nvidia stock", "tsla": "Tesla stock", "aapl": "Apple stock", "msft": "Microsoft stock",
         "meta": "Meta stock", "amzn": "Amazon stock", "googl": "Alphabet stock", "coin": "Coinbase stock", "mstr": "MicroStrategy (Strategy) stock",
         "eur-usd": "EUR/USD", "usd-jpy": "USD/JPY", "gbp-usd": "GBP/USD", "usd-chf": "USD/CHF", "aud-usd": "AUD/USD", "usd-cad": "USD/CAD"}

# A call counts only when its asset is named in the post itself (English or Russian/Ukrainian): the model sometimes pins a
# general remark ("don't buy the whole market") or another market (the Moscow exchange) on an asset of our list.
MENTION = {
    "btc": r"bitcoin|\bbtc|биткоин|біткоїн|биток|битк|біток|бтц", "eth": r"ethereum|\beth\b|ether\b|эфир|ефір|етер",
    "sol": r"solana|\bsol\b|солан", "xrp": r"\bxrp|ripple|рипл", "bnb": r"\bbnb", "doge": r"doge|додж|доге", "ton": r"\bton\b|toncoin|\bтон\b|тонкоин",
    "sui": r"\bsui\b", "gold": r"gold|xau|золот", "silver": r"silver|xag|серебр|срібл", "brent": r"oil|brent|wti|crude|нефт|нафт|брент",
    "spx": r"s&p|spx|\bspy\b|sp500|снп|s&p ?500|американск\w* (рын|акци|индекс)|stock market|equities|stocks", "ndx": r"nasdaq|ndx|\bqqq|насдак",
    "dxy": r"dxy|dollar|доллар|долар", "nvda": r"nvda|nvidia|нвидиа|nvidia", "tsla": r"tsla|tesla|тесл", "aapl": r"aapl|apple|эппл|апл",
    "msft": r"msft|microsoft|майкрософт", "meta": r"\bmeta\b|facebook|\bмета\b", "amzn": r"amzn|amazon|амазон", "googl": r"googl|alphabet|google|гугл",
    "coin": r"coinbase|\$coin|коинбейс", "mstr": r"mstr|microstrategy|\bstrategy inc|\bstrategy \(mstr|микростратеджи",
    "eur-usd": r"eur/?usd|\bевро\b", "usd-jpy": r"usd/?jpy|\bиен\w{0,2}\b|\bєн\w{0,2}\b|\byen\b", "gbp-usd": r"gbp/?usd|\bфунт", "usd-chf": r"usd/?chf|\bфранк",
    "aud-usd": r"aud/?usd|австралийск\w* доллар", "usd-cad": r"usd/?cad|канадск\w* доллар"}
MENTION = {a: re.compile(r, re.I) for a, r in MENTION.items()}

SYSTEM = """You read posts from a market blogger's public Telegram channel (often in Russian or Ukrainian) and list the author's own short-term directional calls.
A call is the author clearly saying that an asset will go up or down over the next days to about two weeks, or that they are buying, going long,
selling or going short on it now (a trade they opened with entry and targets counts).
Leave out: news and reposted headlines, other people's views, long-term targets (months or years), "if it breaks this level then..." scenarios
and both-ways plans without a stated lean, ads, giveaways, referral and course promos, and anything you are unsure about. Most posts have no call.
For each call give the post id, the asset id from the list, the direction, and a quote of 4 to 25 words copied exactly from that post where the author says it."""


def key_of(handle):
    """Leader key for a channel: X handles stay as they are, Telegram ones get a prefix (one person can be on both)."""
    return "tg-" + handle.lower()


def _num(s):
    s = (s or "").strip().upper().replace(",", ".")
    m = 1
    if s.endswith("K"):
        m, s = 1e3, s[:-1]
    elif s.endswith("M"):
        m, s = 1e6, s[:-1]
    try:
        return int(float(s) * m)
    except ValueError:
        return 0


def _text(raw):
    raw = re.sub(r"<br\s*/?>", "\n", raw)
    raw = re.sub(r"<i class=\"emoji\"[^>]*>(.*?)</i>", r"\1", raw, flags=re.S)
    return re.sub(r"[ \t]+", " ", H.unescape(re.sub(r"<[^>]+>", "", raw))).strip()


def parse(page, handle):
    """(profile fields, posts) from one t.me/s page. posts: [{n, t, text, views, fwd}] oldest first."""
    def meta(p):
        m = re.search(r'<meta property="%s" content="([^"]*)"' % p, page)
        return H.unescape(m.group(1)) if m else ""
    subs = re.search(r'<span class="counter_value">([^<]+)</span>\s*<span class="counter_type">subscribers', page)
    pic = re.search(r'tgme_page_photo_image[^>]*>\s*<img src="([^"]+)"', page)
    prof = {"title": meta("og:title"), "bio": meta("og:description"), "fol": _num(subs.group(1)) if subs else 0,
            "pic": pic.group(1) if pic and re.match(r"https://cdn\d*\.(telesco\.pe|cdn-telegram\.org)/", pic.group(1)) else None}
    posts = []
    for blk in re.split(r'(?=<div class="tgme_widget_message_wrap)', page)[1:]:
        m = re.search(r'data-post="([^"/]+)/(\d+)"', blk)
        if not m or m.group(1).lower() != handle.lower():
            continue
        t = re.search(r'<time datetime="([^"]+)"', blk)
        body = re.search(r'<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', blk, re.S)
        v = re.search(r'<span class="tgme_widget_message_views">([^<]+)</span>', blk)
        try:
            ts = int(datetime.fromisoformat(t.group(1).replace("Z", "+00:00")).timestamp()) if t else None
        except ValueError:
            ts = None
        posts.append({"n": int(m.group(2)), "t": ts, "text": _text(body.group(1)) if body else "", "views": _num(v.group(1)) if v else 0,
                      "fwd": "tgme_widget_message_forwarded_from" in blk})
    return prof, sorted(posts, key=lambda p: p["n"])


def _get(url, tries=2):
    last = None
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25).read().decode("utf-8", "ignore")
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
            time.sleep(2 + 3 * i)
    raise last


def read_channel(handle, after, since, log):
    """Profile and posts newer than post number `after` (and not older than `since`), going back up to PAGES pages."""
    prof, got, before = None, {}, None
    for _ in range(PAGES if after else PAGES_FIRST):
        page = _get("https://t.me/s/%s%s" % (handle, "?before=%d" % before if before else ""))
        p, posts = parse(page, handle)
        prof = prof or p
        if not posts:
            break
        for x in posts:
            got[x["n"]] = x
        oldest = posts[0]
        if oldest["n"] <= after or (oldest["t"] and oldest["t"] < since) or oldest["n"] <= 1:
            break
        before = oldest["n"]
    allp = sorted(got.values(), key=lambda x: x["n"])
    views = [x["views"] for x in allp if x["views"]][-20:]
    prof = dict(prof or {}, reach=int(statistics.median(views)) if views else 0)
    return prof, [x for x in allp if x["n"] > after and x["t"] and x["t"] >= since]


def _norm(s):
    return re.sub(r"[\W_]+", " ", (s or "").lower().replace("ё", "е")).strip()


def calls_of(client, name, posts, log):
    """{post n: ({asset: +1|-1}, {asset: quote})} for one channel's new posts, read by Claude in one call."""
    schema = {"type": "object", "additionalProperties": False, "required": ["calls"], "properties": {"calls": {"type": "array", "items": {
        "type": "object", "additionalProperties": False, "required": ["post", "asset", "dir", "quote"],
        "properties": {"post": {"type": "integer"}, "asset": {"type": "string", "enum": sorted(NAMES)}, "dir": {"type": "string", "enum": ["up", "down"]}, "quote": {"type": "string"}}}}}}
    assets = "\n".join("%s: %s" % kv for kv in NAMES.items())
    body = "\n\n".join("[post %d]\n%s" % (p["n"], p["text"][:3000]) for p in posts)
    r = client.messages.create(model=MODEL, max_tokens=4000, system=SYSTEM,
                               output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
                               messages=[{"role": "user", "content": "Assets:\n%s\n\nChannel: %s\n\nPosts:\n%s" % (assets, name, body)}])
    if r.stop_reason not in ("end_turn", "stop_sequence"):
        log("telegram: claude stopped:", r.stop_reason)
        return {}
    out = json.loads("".join(b.text for b in r.content if b.type == "text") or "{}")
    by_n = {p["n"]: p for p in posts}
    score, quotes = {}, {}
    for c in out.get("calls") or []:
        p = by_n.get(c.get("post"))
        q = _norm(c.get("quote"))
        if not p or c.get("asset") not in NAMES or len(q.split()) < 3 or q not in _norm(p["text"]):
            continue
        if c["asset"] in MENTION and not MENTION[c["asset"]].search(p["text"]):
            continue  # the asset is not named in the post
        s = score.setdefault(p["n"], {})
        s[c["asset"]] = s.get(c["asset"], 0) + (1 if c.get("dir") == "up" else -1)
        quotes.setdefault(p["n"], {}).setdefault(c["asset"], c["quote"].strip()[:240])
    res = {}
    for n, s in score.items():
        tags = {a: (1 if v > 0 else -1) for a, v in s.items() if v}
        if tags:
            res[n] = (tags, {a: quotes[n][a] for a in tags})
    return res


def _client(log):
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    try:
        import anthropic
        return anthropic.Anthropic(max_retries=2, timeout=120)
    except Exception as e:  # noqa
        log("telegram: no anthropic SDK, English posts by words only:", e)
        return None


def _latin(s):
    letters = re.findall(r"[^\W\d_]", s or "")
    return bool(letters) and sum(1 for c in letters if c.isascii()) / len(letters) > 0.9


def fetch(channels, prev, last, now, log, tag):
    """(profiles, posts, last) for the channels. prev: last run's Telegram profiles {key: profile}; last: {handle: newest post n read}.
    tag: crowd.tag, the word rules used for English posts when Claude is not available."""
    client, read = _client(log), 0
    cap = MAX_READ_NEW if any(not (last or {}).get(c["tg"]) for c in channels) else MAX_READ
    profiles, posts, nxt = {}, [], dict(last or {})
    today = time.strftime("%Y-%m-%d", time.gmtime(now))
    for c in channels:
        h, k = c["tg"], key_of(c["tg"])
        after = int((last or {}).get(h) or 0)
        try:
            prof, new = read_channel(h, after, now - FIRST, log)
        except Exception as e:  # noqa  # a channel that fails keeps its last profile
            log("telegram: %s failed: %s" % (h, e))
            if k in prev:
                profiles[k] = {**prev[k], "name": c["name"], "g": c["g"]}
            continue
        fol, reach = prof.get("fol") or 0, prof.get("reach") or 0
        ok = fol >= MIN_SUBS and reach >= MIN_VIEWS
        if not ok:
            log("telegram: %s skipped, %d subscribers, median views %d" % (h, fol, reach))
        profiles[k] = {"h": k, "src": "tg", "tg": h, "name": c["name"], "g": c["g"], "fol": fol or None, "reach": reach or None,
                       "pic": prof.get("pic"), "blue": False, "bio": (prof.get("bio") or "")[:240], "ok": ok, "checked": today}
        own = [p for p in new if not p["fwd"] and len(p["text"]) >= 12]
        if not ok:
            if new:
                nxt[h] = max(p["n"] for p in new)
            continue
        found = {}
        if client and own:
            room = cap - read
            if room <= 0:  # no room left this run: leave tg_last alone, these posts are read next hour
                continue
            batch = own[:room]  # oldest first, so a cut never skips posts for good
            read += len(batch)
            try:
                found = calls_of(client, c["name"], batch, log)
            except Exception as e:  # noqa  # a failed read leaves tg_last alone: the same posts are read again next hour
                log("telegram: claude failed on", h, e)
                continue
            last_n = batch[-1]["n"]
            nxt[h] = max([last_n] + [p["n"] for p in new if p["n"] <= last_n])
            own = batch
        elif new:
            nxt[h] = max(p["n"] for p in new)
        for p in own:
            if p["n"] in found:
                tg, q = found[p["n"]]
            elif not client and _latin(p["text"]):
                tg, q = tag(p["text"]), {}
            else:
                tg, q = {}, {}
            # posts without a call go back too: crowd.py scans every post for coin promotions (ops/vetting.py)
            posts.append({"id": "%s/%d" % (h, p["n"]), "h": k, "t": p["t"], "text": p["text"][:1500], "src": "tg", "tag": tg, **({"q": q} if q else {})})
    log("telegram: %d channels, %d ok, %d posts read by Claude, %d with calls" % (
        len(channels), sum(1 for p in profiles.values() if p.get("ok")), read, sum(1 for p in posts if p["tag"])))
    return profiles, posts, nxt


if __name__ == "__main__":  # manual check: python3 telegram.py [n]  (reads the first n channels, no state; spends Claude credit if the key is set)
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import crowd
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "leaders.json"), encoding="utf-8") as f:
        ch = json.load(f).get("telegram") or []
    pr, ps, _ = fetch(ch[:int(sys.argv[1]) if len(sys.argv) > 1 else 3], {}, {}, int(time.time()), print, crowd.tag)
    print(json.dumps({"profiles": {k: [v["fol"], v["reach"], v["ok"], v["pic"]] for k, v in pr.items()},
                      "posts": [{k: p.get(k) for k in ("id", "tag", "q", "text")} for p in ps]}, ensure_ascii=False, indent=1)[:8000])
