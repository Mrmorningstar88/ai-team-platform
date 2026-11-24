#!/usr/bin/env python3
"""Win rate of a Telegram blogger over years of history, not just the posts we happened to read since we started.

Arut 2026-10-31: «смотреть все, что он рекомендовал, за последние несколько лет, и графики, которые он выставляет».
For each channel:
  1. Read the public preview t.me/s/<channel> backwards (?before=<post>) down to YEARS ago. No login, no bot.
  2. Keep the author's own posts that name a coin or carry a picture (charts), and give them to Claude in batches,
     text plus the chart image, to list concrete trade ideas: coin, long or short, entry, targets, stop, horizon,
     and an exact quote from the post.
  3. Check every idea on real Binance daily candles (data-api.binance.vision, public, no key):
       - an entry below/above the price must be touched first, otherwise the idea "never triggered" and is not counted;
       - the first target hit before the stop is a win, the stop first is a loss (both on the same day counts as a loss);
       - no targets and no stop: the price after the horizon must have moved the called way by more than FLAT;
       - neither within the horizon, or no candles for the coin: not counted.
  4. "What a follower would have made": $100 into every checked idea, no leverage, out at the first target, the stop or the
     horizon; the running total is the curve.
  5. Print the result and write <out>/history-<channel>.json.

Pilot: python3 history.py <out_dir> channel1,channel2 ...  (env ANTHROPIC_API_KEY; HIST_YEARS, HIST_MAX_POSTS, HIST_MAX_IMAGES)
"""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import telegram as TG  # noqa: E402

DAY = 86400
YEARS = float(os.environ.get("HIST_YEARS", "3"))
MAX_POSTS = int(os.environ.get("HIST_MAX_POSTS", "3000"))     # posts sent to Claude per channel
MAX_IMAGES = int(os.environ.get("HIST_MAX_IMAGES", "800"))    # charts sent to Claude per channel
BATCH = 8
MODEL = "claude-haiku-5-5"
MARKET = os.environ.get("HIST_MARKET", "crypto")  # crypto: Binance only; stocks: also Moscow Exchange (ISS) and Yahoo (US, indices, FX, gold, oil)
FLAT = 0.01
H_DEFAULT = 14       # days, when the post names no horizon
H_MAX = 90
STAKE = 100       # $ a follower puts into each idea
STABLE = {"USDT", "USDC", "DAI", "FDUSD", "TUSD", "BUSD", "USD", "RUB", "EUR"}
TICKER = re.compile(r"\$[A-Za-z]{2,10}\b|\b[A-Z][A-Z0-9]{1,7}(?:/?USDT)?\b")   # case-sensitive: BTC, PEPE, $wif
NAMES = re.compile("|".join(r.pattern for a, r in TG.MENTION.items() if a in ("btc", "eth", "sol", "xrp", "bnb", "doge", "ton", "sui"))
                   + r"|альт|монет|лонг|шорт|long|short|вход|тейк|стоп", re.I)
PHOTO = re.compile(r"tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)")

SYSTEM = """You read posts from a crypto blogger's public Telegram channel (often in Russian) together with the chart pictures they post.
List every concrete trade idea or forecast the AUTHOR makes on a crypto coin: the coin will go up or down, or they open/advise a long or short.
For each idea give: post id, coin ticker as on Binance (BTC, ETH, SOL, PEPE...), direction, entry price if one is named (null = at the current price),
take-profit targets (numbers, in order), stop-loss (number or null), horizon in days if the post says one (null otherwise),
and a quote of 4 to 30 words copied exactly from the post text where the idea is stated (if the idea is only on the chart, quote the post text that
goes with it). Read levels drawn on the chart only when the post clearly presents the chart as the trade (entry/targets/stop marked on it).
Leave out: news, reposts, other people's views, "if it breaks X then..." scenarios without a stated lean, long-term targets over 3 months,
ads, giveaways, referral promos, and anything you are not sure of. Most posts have no idea. Never invent numbers."""

SYSTEM_STOCKS = """You read posts from an investing blogger's public Telegram channel (often in Russian) together with the chart pictures they post.
List every concrete trade idea or forecast the AUTHOR makes on a tradable asset: a stock, a stock index, a currency pair, gold, oil or a crypto coin
will go up or down, or they buy/sell/advise a long or short.
For each idea give: post id, market and ticker, direction, entry price if one is named (null = at the current price), take-profit targets (numbers,
in order), stop-loss (number or null), horizon in days if the post says one (null otherwise), and a quote of 4 to 30 words copied exactly from the
post text where the idea is stated.
Market and ticker:
  "moex"   = Moscow Exchange shares by their MOEX ticker (SBER, GAZP, LKOH, YNDX/YDEX, MGNT...) and the index IMOEX or RTSI; prices in roubles.
  "yahoo"  = everything else in Yahoo Finance symbols: US/EU stocks (AAPL, NVDA, TSLA), indices (^GSPC for S&P 500, ^NDX for Nasdaq 100,
             ^DJI), currencies (USDRUB=X is "RUB=X", EURUSD=X, CNYRUB=X), gold GC=F, silver SI=F, Brent BZ=F, WTI CL=F, natural gas NG=F.
  "crypto" = crypto coins by Binance ticker (BTC, ETH, SOL...).
Read levels drawn on the chart only when the post clearly presents the chart as the trade.
Leave out: news, reposts, other people's views, macro commentary without a stated trade, "if X then..." scenarios without a stated lean,
long-term targets over 3 months, bonds and funds without a ticker, ads, and anything you are not sure of. Most posts have no idea. Never invent numbers."""

KIND = """
Also tag each idea with kind: "new" = the author opens or advises a fresh trade or makes a fresh forecast now; "update" = a report or brag about an
earlier call ("our long is in profit", "target hit", "since the call +26%") or managing a position already open; "others" = someone else's forecast;
"scenario" = a two-way "if X then..." plan without a stated lean; "long" = a long-term view (months or years)."""
SYSTEM += KIND
SYSTEM_STOCKS += KIND

SCHEMA = {"type": "object", "additionalProperties": False, "required": ["ideas"], "properties": {"ideas": {"type": "array", "items": {
    "type": "object", "additionalProperties": False,
    "required": ["post", "coin", "dir", "entry", "targets", "stop", "days", "quote", "kind"],
    "properties": {"post": {"type": "integer"}, "coin": {"type": "string"}, "dir": {"type": "string", "enum": ["long", "short"]},
                   "kind": {"type": "string", "enum": ["new", "update", "others", "scenario", "long"]},
                   "entry": {"type": ["number", "null"]}, "targets": {"type": "array", "items": {"type": "number"}},
                   "stop": {"type": ["number", "null"]}, "days": {"type": ["integer", "null"]}, "quote": {"type": "string"}}}}}}


SCHEMA_STOCKS = json.loads(json.dumps(SCHEMA))
_it = SCHEMA_STOCKS["properties"]["ideas"]["items"]
_it["required"] = _it["required"] + ["mkt"]
_it["properties"]["mkt"] = {"type": "string", "enum": ["moex", "yahoo", "crypto"]}


def log(*a):
    print(*a, flush=True)


def read_history(handle, since):
    """All posts of the channel newer than `since`, oldest first, with picture URLs."""
    got, before, pages = {}, None, 0
    while pages < 1500:
        page = TG._get("https://t.me/s/%s%s" % (handle, "?before=%d" % before if before else ""))
        pages += 1
        blocks = re.split(r'(?=<div class="tgme_widget_message_wrap)', page)[1:]
        _, posts = TG.parse(page, handle)
        if not posts:
            break
        pics = {}
        for blk in blocks:
            m = re.search(r'data-post="[^"/]+/(\d+)"', blk)
            if m:
                pics[int(m.group(1))] = [u for u in PHOTO.findall(blk) if re.match(r"https://cdn\d*\.(telesco\.pe|cdn-telegram\.org)/", u)]
        for p in posts:
            p["img"] = pics.get(p["n"], [])[:1]
            got[p["n"]] = p
        oldest = posts[0]
        if (oldest["t"] and oldest["t"] < since) or oldest["n"] <= 1 or oldest["n"] == before:
            break
        before = oldest["n"]
        time.sleep(0.4)
    log("%s: %d pages, %d posts" % (handle, pages, len(got)))
    return [p for p in sorted(got.values(), key=lambda x: x["n"]) if p["t"] and p["t"] >= since]


def ideas_of(client, name, posts, usage, market=None, strict=False):
    """Claude's trade ideas in a batch of posts. strict: raise when Claude does not answer (the daily refresh then keeps the
    channel where it was and reads the same posts next time) instead of returning nothing."""
    market = market or MARKET
    content = [{"type": "text", "text": "Channel: %s. Posts follow, oldest first." % name}]
    for p in posts:
        d = datetime.fromtimestamp(p["t"], timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        content.append({"type": "text", "text": "--- post %d, %s ---\n%s" % (p["n"], d, p["text"][:2500] or "(picture only)")})
        for u in p.get("img_use") or []:
            content.append({"type": "image", "source": {"type": "url", "url": u}})
    for attempt in range(2):
        try:
            r = client.messages.create(model=MODEL, max_tokens=6000, system=SYSTEM_STOCKS if market == "stocks" else SYSTEM,
                                       messages=[{"role": "user", "content": content}],
                                       output_config={"format": {"type": "json_schema", "schema": SCHEMA_STOCKS if market == "stocks" else SCHEMA}})
            break
        except Exception as e:  # noqa  # a picture Claude cannot fetch fails the batch: retry once without pictures
            log("  claude:", str(e)[:160])
            if attempt:
                if strict:
                    raise
                return []
            content = [c for c in content if c["type"] == "text"]
    usage["in"] += r.usage.input_tokens
    usage["out"] += r.usage.output_tokens
    txt = "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
    try:
        out = json.loads(txt).get("ideas") or []
    except ValueError:
        if len(posts) > 1 and getattr(r, "stop_reason", "") == "max_tokens":  # the answer was cut (too many ideas): read the two halves on their own
            h = len(posts) // 2
            return (ideas_of(client, name, posts[:h], usage, market, strict) + ideas_of(client, name, posts[h:], usage, market, strict))
        if strict:
            raise
        return []
    by_n = {p["n"]: p for p in posts}
    keep = []
    for x in out:
        p = by_n.get(x.get("post"))
        if not p:
            continue
        q = TG._norm(x.get("quote"))
        if q and q not in TG._norm(p["text"]):  # the quote must really be in the post
            continue
        mkt = x.get("mkt") or "crypto"
        if mkt == "crypto":
            coin = re.sub(r"[^A-Z0-9]", "", (x.get("coin") or "").upper()).replace("USDT", "")
            if coin in STABLE:
                continue
        else:
            coin = re.sub(r"[^A-Z0-9^=.\-]", "", (x.get("coin") or "").upper())
        if not coin:
            continue
        x["mkt"] = mkt
        keep.append(dict(x, coin=coin, t=p["t"], img=bool(p.get("img_use"))))
    return keep


_K = {}
ALIAS = {"XAU": "PAXG", "GOLD": "PAXG"}   # gold: PAX Gold on Binance follows the ounce price


def _moex(sym, t0):
    """Moscow Exchange daily candles from the public ISS API (shares on TQBR, indices on SNDX)."""
    idx = sym in ("IMOEX", "RTSI", "MOEXBC", "RGBI")
    mk, board = ("index", "SNDX") if idx else ("shares", "TQBR")
    base = "https://iss.moex.com/iss/history/engines/stock/markets/%s/boards/%s/securities/%s.json" % (mk, board, sym)
    out, at = [], 0
    while True:
        url = "%s?from=%s&iss.meta=off&history.columns=TRADEDATE,BOARDID,OPEN,HIGH,LOW,CLOSE&start=%d" % (
            base, datetime.fromtimestamp(t0, timezone.utc).strftime("%Y-%m-%d"), at)
        rows = None
        for attempt in range(4):
            try:
                rows = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=TG.UA), timeout=30).read())["history"]["data"]
                break
            except Exception as e:  # noqa
                log("  moex", sym, at, str(e)[:80])
                time.sleep(2 + 3 * attempt)
        if rows is None:
            return []  # a gap in the middle would misjudge ideas: no candles at all is safer
        for d, _board, o, h, l, c in rows:
            if None not in (o, h, l, c):
                out.append((int(datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()), float(o), float(h), float(l), float(c)))
        if len(rows) < 100:
            break
        at += len(rows)
        time.sleep(0.15)
    return sorted(set(out))


def _yahoo(sym, t0):
    """Daily candles from the Yahoo chart API (the same source ops/markets.py uses for FX, gold, oil, stocks, indices)."""
    url = "https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d&interval=1d" % (
        urllib.parse.quote(sym), t0, int(time.time()))
    try:
        r = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20).read())["chart"]["result"][0]
        q = r["indicators"]["quote"][0]
    except Exception:  # noqa
        return []
    out = []
    for i, t in enumerate(r.get("timestamp") or []):
        o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
        if None not in (o, h, l, c):
            out.append((t - t % DAY, float(o), float(h), float(l), float(c)))
    return out


def candles(coin, start, mkt="crypto"):
    """Binance daily candles of <coin>USDT from `start` to now: [(day_ts, open, high, low, close)]; [] when the pair is not on Binance.
    Each coin is downloaded once, all its history at a time (1000 days per call)."""
    if mkt in ("moex", "yahoo"):
        key = mkt + ":" + coin
        if key not in _K:
            t0 = int(time.time()) - int(YEARS * 365 + 60) * DAY
            _K[key] = _moex(coin, t0) if mkt == "moex" else _yahoo(coin, t0)
        return [c for c in _K[key] if c[0] >= start]
    sym = ALIAS.get(coin, coin)
    if sym not in _K:
        out, t = [], int(time.time()) - int(YEARS * 365 + 60) * DAY
        while True:
            url = "https://data-api.binance.vision/api/v3/klines?symbol=%sUSDT&interval=1d&startTime=%d&limit=1000" % (sym, t * 1000)
            try:
                rows = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=TG.UA), timeout=20).read())
            except Exception:  # noqa  # 400 = no such pair
                rows = []
            out += [(r[0] // 1000, float(r[1]), float(r[2]), float(r[3]), float(r[4])) for r in rows]
            time.sleep(0.15)
            if len(rows) < 1000:
                break
            t = rows[-1][0] // 1000 + DAY
        _K[sym] = out
    return [c for c in _K[sym] if c[0] >= start]


# ---------------------------------------------------------------------------------------------------------------------------
# Method v2 (Arut 2026-11-13, «никаких проёбов»): the audit of «Ленивый инвестор» showed three ways the v1 check flattered every
# blogger, so ideas are now judged like this:
#   1. Entry at the price of the moment of the post: the first HOURLY candle that opens after the post, never the day's open
#      (v1 bought at 00:00 UTC, so a "I went long" written after a 10% pump got the pump). Without hourly candles (old Yahoo
#      history) the entry is the next day's open.
#   2. No "expired": an idea with a target and no stop that never reached the target is judged by the price at the end of its
#      horizon like any other idea (v1 dropped it from the win rate, so such an idea could never lose).
#   3. One idea is counted once: the same asset and side posted again while the first one is still open (repost, "our long is
#      in profit", "since the call +26%") is a repeat and is not counted again.
#   Also: target and stop inside the same candle = loss; a short can lose at most the $100 put in; coins missing on Binance are
#   checked on Gate; ideas Claude tagged as not a new trade (kind != "new": brag/update, someone else's forecast, two-way
#   scenario, long-term view) are not counted; the follower has $1,000 and $100 a trade, so at most 10 trades at once (the
#   rest are counted in the win rate but not in the money); below $100 the follower stops (the same rule as Perpetuas).
METHOD = 2
MAX_OPEN = 10
HOUR = 3600
_HK = {}   # (mkt, coin) -> {hour_ts: (o, h, l, c)}
_HR = {}   # (mkt, coin) -> [(a, b)] ranges already fetched
_LIST = {} # (mkt, coin) -> first daily candle ts (listing) or None


def _get_json(url, tries=5):
    """JSON of url; None when the source says there is no such market (400/404). A network failure after all tries raises:
    a half-fetched price history could hide a stop or a target, so such an idea becomes nodata instead of a wrong verdict."""
    for attempt in range(tries):
        try:
            return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read())
        except urllib.error.HTTPError as e:  # noqa
            if e.code in (400, 404, 422):
                return None
            time.sleep(1 + 2 * attempt)
        except Exception:  # noqa
            time.sleep(1 + 2 * attempt)
    raise RuntimeError("no answer from " + url.split("?")[0])


def _h_binance(sym, a, b):
    out, t = [], a
    while t < b:
        rows = _get_json("https://data-api.binance.vision/api/v3/klines?symbol=%sUSDT&interval=1h&startTime=%d&endTime=%d&limit=1000" % (sym, t * 1000, b * 1000))
        if not rows:
            break
        out += [(r[0] // 1000, float(r[1]), float(r[2]), float(r[3]), float(r[4])) for r in rows]
        if len(rows) < 1000:
            break
        t = rows[-1][0] // 1000 + HOUR
    return out


def _h_gate(sym, a, b):
    out = []
    for kind in ("spot", "futures"):
        t = a
        while t < b:
            e = min(b, t + 990 * HOUR)
            url = ("https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=%s_USDT&interval=1h&from=%d&to=%d" if kind == "spot"
                   else "https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=%s_USDT&interval=1h&from=%d&to=%d") % (sym, t, e)
            rows = _get_json(url)
            if not isinstance(rows, list):
                break
            for r in rows:
                if isinstance(r, list):
                    out.append((int(r[0]), float(r[5]), float(r[3]), float(r[4]), float(r[2])))
                elif isinstance(r, dict):
                    out.append((int(r["t"]), float(r["o"]), float(r["h"]), float(r["l"]), float(r["c"])))
            t = e + HOUR
            time.sleep(0.05)
        if out:
            return out
    return out


def _h_moex(sym, a, b):
    idx = sym in ("IMOEX", "RTSI", "MOEXBC", "RGBI")
    mk, board = ("index", "SNDX") if idx else ("shares", "TQBR")
    out, at = [], 0
    d0 = datetime.fromtimestamp(a - DAY, timezone.utc).strftime("%Y-%m-%d")
    d1 = datetime.fromtimestamp(b + DAY, timezone.utc).strftime("%Y-%m-%d")
    while True:
        j = _get_json("https://iss.moex.com/iss/engines/stock/markets/%s/boards/%s/securities/%s/candles.json?from=%s&till=%s&interval=60&iss.meta=off&start=%d" % (mk, board, sym, d0, d1, at))
        rows = ((j or {}).get("candles") or {}).get("data") or []
        cols = ((j or {}).get("candles") or {}).get("columns") or []
        if not rows:
            break
        ix = {c: i for i, c in enumerate(cols)}
        for r in rows:
            ts = int(datetime.strptime(r[ix["begin"]], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()) - 3 * HOUR  # Moscow time
            out.append((ts, float(r[ix["open"]]), float(r[ix["high"]]), float(r[ix["low"]]), float(r[ix["close"]])))
        if len(rows) < 500:
            break
        at += len(rows)
        time.sleep(0.1)
    return out


def _h_yahoo(sym, a, b):
    if a < time.time() - 720 * DAY:  # Yahoo keeps hourly bars for about two years only
        return []
    j = _get_json("https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d&interval=60m" % (urllib.parse.quote(sym), a, b))
    try:
        r = j["chart"]["result"][0]
        q = r["indicators"]["quote"][0]
    except Exception:  # noqa
        return []
    out = []
    for i, t in enumerate(r.get("timestamp") or []):
        o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
        if None not in (o, h, l, c):
            out.append((t, float(o), float(h), float(l), float(c)))
    return out


def hourly(coin, mkt, a, b):
    """Hourly candles of an asset between a and b (unix seconds), sorted; [] when there are none."""
    key = (mkt, coin)
    have = _HK.setdefault(key, {})
    rng = _HR.setdefault(key, [])
    if not any(x <= a and b <= y for x, y in rng):
        a0 = a - a % HOUR
        if mkt == "crypto":
            sym = ALIAS.get(coin, coin)
            rows = _h_binance(sym, a0, b) or _h_gate(sym, a0, b)
        elif mkt == "moex":
            rows = _h_moex(coin, a0, b)
        else:
            rows = _h_yahoo(coin, a0, b)
        for r in rows:
            have[r[0]] = r[1:]
        rng.append((a, b))
    return [(t,) + have[t] for t in sorted(have) if a <= t < b]


def listed_since(coin, mkt):
    """The first daily candle of the asset (its listing on the exchange we check it on), or None."""
    key = (mkt, coin)
    if key not in _LIST:
        k = candles(coin, 0, mkt) if mkt != "crypto" or ALIAS.get(coin, coin) else []
        if not k and mkt == "crypto":  # not on Binance: Gate keeps the daily history
            j = _get_json("https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=%s_USDT&interval=1d&limit=1000&from=%d" % (coin, int(time.time()) - int(YEARS * 365 + 60) * DAY))
            k = [(int(r[0]),) for r in j] if isinstance(j, list) and j and isinstance(j[0], list) else []
            if not k:
                j = _get_json("https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=%s_USDT&interval=1d&limit=1000&from=%d" % (coin, int(time.time()) - int(YEARS * 365 + 60) * DAY))
                k = [(int(r["t"]),) for r in j] if isinstance(j, list) and j and isinstance(j[0], dict) else []
        _LIST[key] = k[0][0] if k else None
    return _LIST[key]


def judge2(x, now):
    """(result, pct, exit_ts): win | loss | flat | open | untriggered | nodata. pct = price move from the entry (not signed by side)."""
    mkt = x.get("mkt") or "crypto"
    t = int(x["t"])
    days = min(H_MAX, x.get("days") or H_DEFAULT)
    end = t + days * DAY
    if end > now:
        return "open", None, None
    first = listed_since(x["coin"], mkt)
    if first is None or first > t - 2 * DAY:  # not trading yet, or listed these very days: a listing-day price is no fair entry
        return "nodata", None, None
    path = [c for c in hourly(x["coin"], mkt, t - HOUR, end + HOUR) if c[0] >= t and c[0] < end]
    if not path:  # no hourly bars (old stock history): enter at the next day's open, daily bars after it
        k = candles(x["coin"], t - t % DAY + DAY, mkt)
        path = [c for c in k if c[0] < end]
    if not path or path[0][0] - t > 4 * DAY:  # the asset did not trade after the post for days: nothing fair to check
        return "nodata", None, None
    long_ = x["dir"] == "long"
    p0 = path[0][1]
    entry, tg, st = x.get("entry"), [v for v in (x.get("targets") or []) if v], x.get("stop")
    if entry and abs(entry / p0 - 1) > 0.5:  # a level that far away is a misread
        entry = None
    if entry:  # wait for the entry to be touched
        for i, c in enumerate(path):
            if c[3] <= entry <= c[2]:
                path = path[i:]
                break
        else:
            return "untriggered", None, None
    ref = entry or p0
    tg = [v for v in tg if (v > ref if long_ else v < ref)]
    if st is not None and not (st < ref if long_ else st > ref):
        st = None
    for c in path:
        hit_s = st is not None and (c[3] <= st if long_ else c[2] >= st)
        hit_t = bool(tg) and (c[2] >= tg[0] if long_ else c[3] <= tg[0])
        if hit_s:  # the stop first, or both inside one candle: we cannot know the order, so it counts against the blogger
            return "loss", round((st / ref - 1) * 100, 2), c[0]
        if hit_t:
            return "win", round((tg[0] / ref - 1) * 100, 2), c[0]
    ch = path[-1][4] / ref - 1
    if abs(ch) < FLAT:
        return "flat", round(ch * 100, 2), end
    return ("win" if (ch > 0) == long_ else "loss"), round(ch * 100, 2), end


def settle(ideas, now):
    """v2: drop repeats, judge every idea from the moment of its post, then the follower's money ($1,000, $100 a trade,
    at most MAX_OPEN trades at once, stops below $100)."""
    seen, uniq = set(), []
    for x in sorted(ideas, key=lambda x: x["t"]):
        key = (x["post"], x["coin"], x["dir"])
        if key not in seen:
            seen.add(key)
            uniq.append(x)
    res, live = {}, {}
    for x in uniq:
        for k in ("pnl", "exit", "why"):
            x.pop(k, None)
        kind = x.get("kind") or "new"
        mk = (x.get("mkt") or "crypto", x["coin"], x["dir"])
        if kind != "new":
            x["res"], x["pct"], x["why"] = "skip", None, kind
        elif live.get(mk, 0) > x["t"]:
            x["res"], x["pct"], x["why"] = "repeat", None, "repeat"
        else:
            try:
                x["res"], x["pct"], x["exit"] = judge2(x, now)
            except Exception as e:  # noqa
                log("  judge failed on", x.get("coin"), x.get("post"), e)
                x["res"], x["pct"], x["exit"] = "nodata", None, None
            if x["res"] not in ("nodata", "untriggered"):
                # later posts on the same asset and side are repeats while this idea is still open (until its stop/target or its term ends)
                live[mk] = x.get("exit") or x["t"] + min(H_MAX, x.get("days") or H_DEFAULT) * DAY
        res[x["res"]] = res.get(x["res"], 0) + 1
    # the follower: trades open at the post and close at their exit; a new one is taken only while fewer than MAX_OPEN are open
    bank, pnl, curve, opened, stopped = 1000.0, 0.0, [], [], False
    for x in sorted((x for x in uniq if x["res"] in ("win", "loss", "flat") and x["pct"] is not None), key=lambda x: x["t"]):
        done = [o for o in opened if o["exit"] <= x["t"]]
        for o in sorted(done, key=lambda o: o["exit"]):
            bank += o["pnl"]
            curve.append([o["exit"], round(bank - 1000, 2)])
            opened.remove(o)
        if stopped or bank < STAKE:
            stopped = True
            continue
        if len(opened) >= MAX_OPEN:
            x["why"] = "full"  # counted in the win rate, but the follower had no free $100 for it
            continue
        sgn = x["pct"] if x["dir"] == "long" else -x["pct"]
        x["pnl"] = round(max(-STAKE, STAKE * sgn / 100), 2)
        opened.append(x)
    for o in sorted(opened, key=lambda o: o["exit"]):
        bank += o["pnl"]
        curve.append([o["exit"], round(bank - 1000, 2)])
    pnl = round(bank - 1000, 2)
    return uniq, res, pnl, curve


def rejudge(path, now):
    """Judge a saved history-<channel>.json again (new checking rules) without asking Claude again."""
    d = json.load(open(path, encoding="utf-8"))
    summ = d["summary"]
    ideas, res, pnl, curve = settle(d["ideas"], now)
    w, l = res.get("win", 0), res.get("loss", 0)
    summ.update(ideas=len(ideas), res=res, wr=round(w / (w + l) * 100) if w + l else None, checked=w + l,
                followed=sum(1 for x in ideas if x.get("pnl") is not None), pnl_usd=pnl, curve=curve)
    return summ, ideas


TICK_NAME = {"RUB=X": "USDRUB", "GC=F": "GOLD", "SI=F": "SILVER", "BZ=F": "BRENT", "CL=F": "WTI", "NG=F": "GAS", "^GSPC": "S&P500", "^NDX": "NASDAQ100", "^DJI": "DOW"}


def _btc_close(day_ts):
    k = candles("BTC", day_ts - 3 * DAY, "crypto")
    k = [c for c in k if c[0] <= day_ts]
    return k[-1][4] if k else None


def _coin_flip(ideas):
    """What blind luck gives on the same ideas: the share of wins if every side were flipped (same asset, same minute,
    same horizon). A blogger is only better than a coin when their win rate beats 50% by more than the error."""
    w = sum(1 for x in ideas if x["res"] == "win")
    l = sum(1 for x in ideas if x["res"] == "loss")
    n = w + l
    if not n:
        return None
    return {"n": n, "wr": round(w / n * 100), "err": round(1.96 * (0.25 / n) ** 0.5 * 100)}


def pack(handle, summ, ideas):
    """The compact form the site shows (ops/leaders_history.json, key tg-<channel>): totals, the follower's money by month with
    BTC held from the same start, totals per year, every counted trade (for «Победитель и проигравший») and the latest
    checked ideas with a quote."""
    ideas = sorted(ideas, key=lambda x: x["t"])
    counted = [x for x in ideas if x["res"] in ("win", "loss")]
    money = [x for x in ideas if x.get("pnl") is not None]
    month, years = {}, {}
    for t, v in summ.get("curve") or []:
        month[datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m")] = v
    for x in counted:
        y = years.setdefault(datetime.fromtimestamp(x["t"], timezone.utc).strftime("%Y"), [0, 0, 0.0])
        y[0] += x["res"] == "win"
        y[1] += x["res"] == "loss"
    for x in money:
        y = years.setdefault(datetime.fromtimestamp(x["exit"], timezone.utc).strftime("%Y"), [0, 0, 0.0])
        y[2] = round(y[2] + x["pnl"], 2)
    first = ideas[0]["t"] if ideas else None
    base, b0 = [], _btc_close(first - first % DAY) if first else None
    cv = []
    for m in sorted(month):
        mt = int(datetime.strptime(m + "-28", "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())
        bc = _btc_close(min(mt, int(time.time()) - DAY))
        cv.append([m, round(1000 + month[m], 2), round(1000 * bc / b0, 2) if b0 and bc else None])
    nm = lambda x: TICK_NAME.get(x["coin"]) or re.sub(r"=X$|=F$|^\^", "", x["coin"])
    lst = [{"d": datetime.fromtimestamp(x["t"], timezone.utc).strftime("%Y-%m-%d"), "n": x["post"], "c": nm(x), "s": "l" if x["dir"] == "long" else "s",
            "r": x["res"], "p": x["pct"], "q": (x.get("quote") or "")[:160]} for x in counted][-40:]
    res = summ["res"]
    w, l = res.get("win", 0), res.get("loss", 0)
    return {"m": METHOD, "ch": handle, "from": datetime.fromtimestamp(first, timezone.utc).strftime("%Y-%m-%d") if first else summ.get("from"),
            "upd": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "posts": summ["posts"], "read": summ["read"],
            "ideas": len(ideas), "win": w, "loss": l, "flat": res.get("flat", 0), "repeat": res.get("repeat", 0), "skip": res.get("skip", 0),
            "nodata": res.get("nodata", 0), "untrig": res.get("untriggered", 0),
            "wr": round(w / (w + l) * 100) if w + l else None, "err": round(1.96 * (0.25 / (w + l)) ** 0.5 * 100) if w + l else None,
            "followed": len(money), "stake": STAKE, "max_open": MAX_OPEN, "pnl": summ["pnl_usd"], "bank": round(max(0, 1000 + summ["pnl_usd"]), 2),
            "base": cv[-1][2] if cv else None, "curve": cv, "years": years,
            # every trade the follower took: [settle date, $ result, asset, side, post] (the W&L rubric reads these)
            "trades": [[datetime.fromtimestamp(x["exit"], timezone.utc).strftime("%Y-%m-%d"), x["pnl"], nm(x), 1 if x["dir"] == "long" else -1, x["post"]] for x in money],
            "list": lst, **({"mkt": "stocks"} if any((x.get("mkt") or "crypto") != "crypto" for x in counted) else {})}


def run(handle, client, out_dir, now):
    since = int(now - YEARS * 365 * DAY)
    posts = [p for p in read_history(handle, since) if not p["fwd"]]
    cand, imgs = [], 0
    for p in posts:
        if MARKET != "stocks" and not (TICKER.search(p["text"]) or NAMES.search(p["text"]) or p["img"]):
            continue
        if p["img"] and imgs < MAX_IMAGES:
            p["img_use"] = p["img"]
            imgs += 1
        cand.append(p)
    cand = cand[-MAX_POSTS:]
    log("%s: %d own posts in %.1f years, %d sent to Claude (%d with charts)" % (handle, len(posts), YEARS, len(cand), imgs))
    usage, ideas = {"in": 0, "out": 0}, []
    for i in range(0, len(cand), BATCH):
        ideas += ideas_of(client, handle, cand[i:i + BATCH], usage)
    with open(os.path.join(out_dir, "ideas-%s.json" % handle), "w", encoding="utf-8") as f:  # Claude's work is kept even if a check fails
        json.dump(ideas, f, ensure_ascii=False)
    ideas, res, pnl, curve = settle(ideas, now)
    w, l = res.get("win", 0), res.get("loss", 0)
    cost = usage["in"] / 1e6 * 1.0 + usage["out"] / 1e6 * 5.0
    summ = {"channel": handle, "years": YEARS, "posts": len(posts), "read": len(cand), "ideas": len(ideas), "res": res,
            "wr": round(w / (w + l) * 100) if w + l else None, "checked": w + l, "followed": sum(1 for x in ideas if x.get("pnl") is not None), "stake": STAKE, "pnl_usd": pnl, "curve": curve, "tokens": usage, "cost_usd_est": round(cost, 2),
            "from": datetime.fromtimestamp(posts[0]["t"], timezone.utc).strftime("%Y-%m-%d") if posts else None}
    log("RESULT", json.dumps({k: v for k, v in summ.items() if k != "curve"}, ensure_ascii=False))
    for x in sorted(ideas, key=lambda x: x["t"]):
        log("  %s #%d %s %s entry=%s tp=%s sl=%s %sd -> %s %s | %s" % (
            datetime.fromtimestamp(x["t"], timezone.utc).strftime("%Y-%m-%d"), x["post"], x["coin"], x["dir"], x.get("entry"),
            (x.get("targets") or [])[:3], x.get("stop"), x.get("days"), x["res"], x["pct"], x["quote"][:90]))
    log("HISTJSON", TG.key_of(handle), json.dumps(pack(handle, summ, ideas), ensure_ascii=False, separators=(",", ":")))
    with open(os.path.join(out_dir, "history-%s.json" % handle), "w", encoding="utf-8") as f:
        json.dump({"summary": summ, "ideas": ideas}, f, ensure_ascii=False)
    return summ


# ---------------------------------------------------------------------------------------------------------------------------
# Daily refresh (2026-11-17). leaders_history.json was counted once, on 2026-11-13, so the Telegram channels' trades stopped
# there and «Победитель и проигравший» had no day to show. `history.py update` keeps every channel current with method 2:
#   - the 2026-11-13 record of each channel stays as its frozen base (its trades, money and counts are not redone);
#   - Claude reads only the posts that are new since the last run (the first run also reads GAP_DAYS before the base, to find
#     the ideas that were still open on 2026-11-13 and so were never counted);
#   - every idea after the base is judged with judge2 and settle's rules (repeats against the base trades too) and added to
#     the base: counts, win rate, the follower's money from the base bank on, the curve, the years and the trades.
# The raw ideas live in ops/leaders_history_ideas.json; a judged idea keeps its verdict there, so a run only checks the open ones.
HERE = os.path.dirname(os.path.abspath(__file__))
LH = os.path.join(HERE, "leaders_history.json")
STORE = os.path.join(HERE, "leaders_history_ideas.json")
GAP_DAYS = 30
MAX_NEW = 400      # posts sent to Claude per channel in one run
WORKERS = 6        # channels read by Claude at once


def _day_ts(s):
    return int(datetime.strptime(str(s)[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())


def _ds(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d")


def _nm(x):
    return TICK_NAME.get(x["coin"]) or re.sub(r"=X$|=F$|^\^", "", x["coin"])


def settle_after(base, ideas, cut, now):
    """Method 2 on the ideas that came after the frozen record `base` (made at `cut`). Returns (counted ideas, res, money, bank)."""
    done = {(int(t[4]), t[2], int(t[3])) for t in base.get("trades") or []}
    done |= {(int(x["n"]), x["c"], 1 if x["s"] == "l" else -1) for x in base.get("list") or []}
    live = {}
    for t in base.get("trades") or []:  # a base trade still running makes a later post on it a repeat
        k = (t[2], int(t[3]))
        live[k] = max(live.get(k, 0), _day_ts(t[0]) + DAY)
    seen, uniq = set(), []
    for x in sorted(ideas, key=lambda x: (x["t"], x["post"])):
        k = (x["post"], x["coin"], x["dir"])
        if k not in seen:
            seen.add(k)
            uniq.append(x)
    counted, res = [], {}
    for x in uniq:
        sd = 1 if x["dir"] == "long" else -1
        if (x["post"], _nm(x), sd) in done:
            continue  # already in the base
        mk = (_nm(x), sd)
        x.pop("pnl", None)
        if (x.get("kind") or "new") != "new":
            x["res"], x["pct"], x["exit"] = "skip", None, None
        elif live.get(mk, 0) > x["t"]:
            x["res"], x["pct"], x["exit"] = "repeat", None, None
        else:
            if x.get("fin"):
                x["res"], x["pct"], x["exit"] = x["fin"]
            else:
                try:
                    x["res"], x["pct"], x["exit"] = judge2(x, now)
                    if x["res"] != "open":
                        x["fin"] = [x["res"], x["pct"], x["exit"]]  # final: not checked again
                except Exception as e:  # noqa  # network: no verdict this run, try again next run
                    log("  judge failed on", x.get("coin"), x.get("post"), e)
                    x["res"], x["pct"], x["exit"] = "nodata", None, None
            if x["res"] not in ("nodata", "untriggered"):
                live[mk] = x.get("exit") or x["t"] + min(H_MAX, x.get("days") or H_DEFAULT) * DAY
        if x["res"] == "open":
            continue
        # an idea the base run already saw is not counted again: posted before the base and settled (or dropped) before it
        if x["res"] in ("win", "loss", "flat") and x["exit"] < cut:
            continue
        if x["res"] not in ("win", "loss", "flat") and x["t"] < cut:
            continue
        res[x["res"]] = res.get(x["res"], 0) + 1
        counted.append(x)
    bank = float(base.get("bank") or 0) if (base.get("bank") or 0) >= STAKE else 0.0
    money, opened = [], []
    for x in sorted((x for x in counted if x["res"] in ("win", "loss", "flat") and x["pct"] is not None), key=lambda x: x["t"]):
        for o in sorted([o for o in opened if o["exit"] <= x["t"]], key=lambda o: o["exit"]):
            bank += o["pnl"]
            opened.remove(o)
        if bank < STAKE:
            break  # below $100 the follower stops
        if len(opened) >= MAX_OPEN:
            continue
        sgn = x["pct"] if x["dir"] == "long" else -x["pct"]
        x["pnl"] = round(max(-STAKE, STAKE * sgn / 100), 2)
        opened.append(x)
        money.append(x)
    for o in opened:
        bank += o["pnl"]
    return counted, res, money, bank


def merge(base, counted, res, money, bank, posts, read):
    """The base record plus what came after it, in the shape pack() writes."""
    r = json.loads(json.dumps(base))
    for f, k in (("win", "win"), ("loss", "loss"), ("flat", "flat"), ("repeat", "repeat"), ("skip", "skip"), ("nodata", "nodata"), ("untrig", "untriggered")):
        r[f] = (r.get(f) or 0) + res.get(k, 0)
    r["ideas"] = (r.get("ideas") or 0) + len(counted)
    w, l = r["win"], r["loss"]
    r["wr"] = round(w / (w + l) * 100) if w + l else None
    r["err"] = round(1.96 * (0.25 / (w + l)) ** 0.5 * 100) if w + l else None
    r["posts"], r["read"] = (r.get("posts") or 0) + posts, (r.get("read") or 0) + read
    if (base.get("bank") or 0) >= STAKE or not base.get("trades"):
        r["followed"] = (r.get("followed") or 0) + len(money)
        b = float(base.get("bank") or 1000)
        months = {m: [v, bv] for m, v, bv in r.get("curve") or []}
        b0 = _btc_close(_day_ts(r["from"])) if r.get("from") else None
        for x in sorted(money, key=lambda x: x["exit"]):
            b += x["pnl"]
            m = datetime.fromtimestamp(x["exit"], timezone.utc).strftime("%Y-%m")
            mt = int(datetime.strptime(m + "-28", "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())
            bc = _btc_close(min(mt, int(time.time()) - DAY))
            months[m] = [round(b, 2), round(1000 * bc / b0, 2) if b0 and bc else (months.get(m) or [0, None])[1]]
            r["trades"] = (r.get("trades") or []) + [[_ds(x["exit"]), x["pnl"], _nm(x), 1 if x["dir"] == "long" else -1, x["post"]]]
            y = r.setdefault("years", {}).setdefault(datetime.fromtimestamp(x["exit"], timezone.utc).strftime("%Y"), [0, 0, 0.0])
            y[2] = round(y[2] + x["pnl"], 2)
        r["pnl"] = round(b - 1000, 2)
        r["bank"] = round(max(0, b), 2)
        r["curve"] = [[m] + months[m] for m in sorted(months)]
        r["base"] = r["curve"][-1][2] if r["curve"] else r.get("base")
    for x in counted:
        if x["res"] in ("win", "loss"):
            y = r.setdefault("years", {}).setdefault(datetime.fromtimestamp(x["t"], timezone.utc).strftime("%Y"), [0, 0, 0.0])
            y[0 if x["res"] == "win" else 1] += 1
    lst = (r.get("list") or []) + [{"d": _ds(x["t"]), "n": x["post"], "c": _nm(x), "s": "l" if x["dir"] == "long" else "s", "r": x["res"],
                                    "p": x["pct"], "q": (x.get("quote") or "")[:160]} for x in counted if x["res"] in ("win", "loss")]
    r["list"] = sorted(lst, key=lambda x: (x["d"], x["n"]))[-40:]
    r["upd"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return r


def _read_new(key, S, client):
    """Claude's ideas in the channel's posts after S["last"]; raises on any failure so the channel stays where it was."""
    since = S["lt"] - HOUR if S.get("lt") else S["cut"] - GAP_DAYS * DAY
    posts = [p for p in read_history(S["ch"], since) if p["n"] > S.get("last", 0) and not p["fwd"]]
    cand = [p for p in posts if S["mkt"] == "stocks" or TICKER.search(p["text"]) or NAMES.search(p["text"]) or p["img"]][-MAX_NEW:]
    for p in cand:
        p["img_use"] = p["img"]
    usage, ideas = {"in": 0, "out": 0}, []
    for i in range(0, len(cand), BATCH):
        ideas += ideas_of(client, S["ch"], cand[i:i + BATCH], usage, market=S["mkt"], strict=True)
    log("%s: %d new posts, %d to Claude, %d ideas, $%.2f" % (key, len(posts), len(cand), len(ideas), usage["in"] / 1e6 + usage["out"] / 1e6 * 5))
    return posts, cand, ideas


# ---------------------------------------------------------------------------------------------------------------------------
# Second check (Arut 2026-11-23: «проверь весь метод, возможно мы неверно считали»). The audit found that the first reader
# (Haiku, many posts at once) also counts posts that open nothing: a report on a position already held («всё ещё держу шорт»),
# a brag («я уже неделю про шорты говорю»), a musing with a condition («если индексы упадут на 15-35%...»), a portfolio
# allocation, and it enters "at the market" a trade the author wants only at a better price («шортить ближе к 104»). So every
# idea that can reach the Winner & Loser windows is read again, one post at a time, by a stronger model, with the full post
# text and its chart: keep, drop (not a new trade now), or fix (the entry, targets or stop it names). Verdicts are kept in the
# store (S["ver"], key "post:asset:±1"), so each idea is checked once. A dropped idea is not counted at all; a fixed one is
# judged again with the corrected levels. Base trades (the 2026-11-13 record) are checked the same way when they fall inside
# VER_DAYS, and the base money is corrected by the difference.
VER_MODEL = "claude-sonnet-5-5"
VER_MAX = int(os.environ.get("HIST_VER_MAX") or 120)    # posts sent to the second check per channel in one run (cost cap)
VER_DAYS = int(os.environ.get("HIST_VER_DAYS") or 45)   # trades settled in the last VER_DAYS (all Winner & Loser windows but the year) and every idea still open
# DD report 2026-11-23: the history before the 45 days never had the second check. A manual run with HIST_VER_DAYS=4000 (blogger-history.yml
# input ver_days) checks every base trade once; verdicts stay in the store, so later daily runs only pay for new posts.
VER_SYSTEM = """You are the second, strict checker of a trade-idea extractor for a public ranking of bloggers ("who made their followers money").
You get ONE Telegram post by the author (text, maybe a chart) and the ideas the extractor took from it. A follower is assumed to open each kept
idea right after the post with $100, so be strict: a wrong idea puts a real person's name on a public winner or loser list.
For each idea answer:
  "keep" = in THIS post the author opens, advises or clearly calls a NEW trade or a fresh directional forecast on this asset, this direction,
           now or within days (a short-term call; a stated lean with a condition is fine only if the lean itself is clear).
  "drop" = anything else: a report on a position already open or managing it ("still holding", "we are in longs", "moved the stop"), a brag or
           recap of an earlier call, someone else's view, a two-way scenario, a conditional musing without a clear lean now, a long-term
           investment or portfolio allocation (months or years), macro commentary, a joke, or the post does not support this asset/direction.
  "fix"  = a real new trade, but the extractor got a level wrong: the author enters only at a named price or zone ("short closer to 104",
           "buy near 4000", "limit orders 78-79k") -> entry = that price (the middle of a zone); or the stop/targets are misread or missing
           while the post or chart names them. Give the full corrected levels (null / [] where the post names none).
Read numbers carefully: price levels only, never percentages as prices. Write "why" in a few plain words."""
VER_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["checks"], "properties": {"checks": {"type": "array", "items": {
    "type": "object", "additionalProperties": False, "required": ["i", "verdict", "why", "entry", "targets", "stop"],
    "properties": {"i": {"type": "integer"}, "verdict": {"type": "string", "enum": ["keep", "drop", "fix"]}, "why": {"type": "string"},
                   "entry": {"type": ["number", "null"]}, "targets": {"type": "array", "items": {"type": "number"}},
                   "stop": {"type": ["number", "null"]}}}}}}
_PAGE = {}


def post_of(ch, n):
    """The post n of channel ch from the public preview: {"n", "t", "text", "img"}, or None."""
    k = (ch, n)
    if k not in _PAGE:
        page = TG._get("https://t.me/s/%s?before=%d" % (ch, n + 1))
        _, posts = TG.parse(page, ch)
        pics = {}
        for blk in re.split(r'(?=<div class="tgme_widget_message_wrap)', page)[1:]:
            m = re.search(r'data-post="[^"/]+/(\d+)"', blk)
            if m:
                pics[int(m.group(1))] = [u for u in PHOTO.findall(blk) if re.match(r"https://cdn\d*\.(telesco\.pe|cdn-telegram\.org)/", u)]
        for p in posts:
            p["img"] = pics.get(p["n"], [])[:1]
            _PAGE[(ch, p["n"])] = p
        _PAGE.setdefault(k, None)
    return _PAGE[k]


def vkey(post, name, sd):
    return "%d:%s:%d" % (int(post), name, int(sd))


# Arut 2026-11-24: routine work goes to cheaper models. HIST_VER_MODEL picks the second checker: claude-* (Anthropic, default),
# gemini-* (Google, GEMINI_API_KEY/GOOGLE_API_KEY) or gpt-*/o* (OpenAI, OPENAI_API_KEY). «history.py vercal m1,m2» measures each
# model against the Sonnet verdicts already in the store before a cheaper one is trusted with the full history.
VER_MODEL = os.environ.get("HIST_VER_MODEL") or VER_MODEL
PRICE = {"claude-sonnet": (3, 15), "claude-haiku": (1, 5), "gemini-2.5-flash-lite": (0.1, 0.4), "gemini-2.5-flash": (0.3, 2.5),
         "gpt-5-nano": (0.05, 0.4), "gpt-5-mini": (0.25, 2), "gpt-4.1-mini": (0.4, 1.6), "gpt-4.1-nano": (0.1, 0.4),
         "grok-4-fast": (0.2, 0.5), "grok-4-1-fast": (0.2, 0.5), "grok-3-mini": (0.3, 0.5)}


def price_of(model):
    """$ per million tokens (input, output) for the cost line in the log; unknown models are priced as Sonnet so a cost is never understated."""
    return next((v for k, v in sorted(PRICE.items(), key=lambda kv: -len(kv[0])) if model.startswith(k)), (3, 15))


def _post_json(url, body, headers, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=dict(headers, **{"Content-Type": "application/json"}))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %d %s" % (e.code, e.read()[:300].decode("utf-8", "replace")))


def _img_b64(u):
    import base64
    with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
        return r.headers.get("Content-Type") or "image/jpeg", base64.b64encode(r.read()).decode()


def _ask_other(model, text, imgs, usage):
    """The same check on Gemini or OpenAI: returns the parsed {"checks": [...]} dict."""
    if model.startswith("gemini"):
        key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        parts = [{"text": text}] + [{"inlineData": {"mimeType": m, "data": b}} for m, b in (_img_b64(u) for u in imgs)]
        body = {"systemInstruction": {"parts": [{"text": VER_SYSTEM}]}, "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {"responseMimeType": "application/json", "responseJsonSchema": VER_SCHEMA, "temperature": 0}}
        r = _post_json("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s" % (model, key), body, {})
        u = r.get("usageMetadata") or {}
        usage["in"] += u.get("promptTokenCount") or 0
        usage["out"] += (u.get("candidatesTokenCount") or 0) + (u.get("thoughtsTokenCount") or 0)
        return json.loads("".join(pt.get("text", "") for pt in r["candidates"][0]["content"]["parts"]))
    xai = model.startswith("grok")  # xAI speaks the OpenAI chat API
    key = (os.environ.get("XAI_API_KEY") or os.environ.get("XAI_API_KE")) if xai else os.environ.get("OPENAI_API_KEY")
    url = ("https://api.x.ai/v1" if xai else "https://api.openai.com/v1") + "/chat/completions"
    content = [{"type": "text", "text": text}] + [{"type": "image_url", "image_url": {"url": u}} for u in imgs]
    body = {"model": model, "messages": [{"role": "system", "content": VER_SYSTEM}, {"role": "user", "content": content}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "checks", "strict": True, "schema": VER_SCHEMA}}}
    if model.startswith(("gpt-5", "o")):
        body["reasoning_effort"] = "low"
    try:
        r = _post_json(url, body, {"Authorization": "Bearer " + key})
    except RuntimeError as e:
        if "reasoning_effort" not in str(e):
            raise
        body.pop("reasoning_effort")
        r = _post_json(url, body, {"Authorization": "Bearer " + key})
    usage["in"] += r["usage"]["prompt_tokens"]
    usage["out"] += r["usage"]["completion_tokens"]
    return json.loads(r["choices"][0]["message"]["content"])


def verify_post(client, ch, p, items, usage, model=None):
    """items: [{"coin","dir","entry","targets","stop","quote"}] from post p -> [{verdict, why, entry, targets, stop}] in the same order."""
    model = model or VER_MODEL
    d = datetime.fromtimestamp(p["t"], timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lst = "\n".join("%d. %s %s entry=%s targets=%s stop=%s quote=%s" % (i, x["name"], x["dir"], x.get("entry"), x.get("targets") or [],
                                                                         x.get("stop"), json.dumps(x.get("quote") or "", ensure_ascii=False))
                    for i, x in enumerate(items))
    text = "Channel @%s, post %d, %s:\n%s\n\nExtracted ideas:\n%s" % (ch, p["n"], d, p["text"][:4000] or "(picture only)", lst)
    if not model.startswith("claude"):
        imgs = list(p.get("img") or [])
        for attempt in range(2):
            try:
                got = _ask_other(model, text, imgs, usage)
                break
            except Exception as e:  # noqa  # a chart the model cannot fetch: once more, text only
                if attempt:
                    raise
                log("  verify:", str(e)[:160])
                imgs = []
        got = {c["i"]: c for c in got.get("checks") or []}
        return [got.get(i) for i in range(len(items))]
    content = [{"type": "text", "text": text}]
    for u in p.get("img") or []:
        content.append({"type": "image", "source": {"type": "url", "url": u}})
    for attempt in range(2):
        try:
            r = client.messages.create(model=model, max_tokens=2000, timeout=120, system=VER_SYSTEM, messages=[{"role": "user", "content": content}],
                                       output_config={"format": {"type": "json_schema", "schema": VER_SCHEMA}})
            break
        except Exception as e:  # noqa  # a chart Claude cannot fetch: once more, text only
            if attempt:
                raise
            log("  verify:", str(e)[:160])
            content = content[:1]
    usage["in"] += r.usage.input_tokens
    usage["out"] += r.usage.output_tokens
    got = {c["i"]: c for c in json.loads("".join(b.text for b in r.content if getattr(b, "type", "") == "text")).get("checks") or []}
    return [got.get(i) for i in range(len(items))]


def _verify(key, S, base, client, now):
    """Check (once) every idea of the channel that can reach the Winner & Loser windows. Returns the number checked now."""
    ver = S.setdefault("ver", {})
    since = now - VER_DAYS * DAY
    want = {}  # post -> {vkey: item}
    for x in S["ideas"]:
        sd = 1 if x["dir"] == "long" else -1
        k = vkey(x["post"], _nm(x), sd)
        if k in ver or (x.get("kind") or "new") != "new":
            continue
        ex = (x.get("fin") or [None, None, None])[2]
        if (ex if ex is not None else x["t"] + min(H_MAX, x.get("days") or H_DEFAULT) * DAY) < since:
            continue  # settled (or ran out) before the windows
        want.setdefault(x["post"], {})[k] = dict(x, name=_nm(x))
    by = {(x["post"], _nm(x), 1 if x["dir"] == "long" else -1): x for x in S["ideas"]}
    q = {(x["n"], x["c"], 1 if x["s"] == "l" else -1): x.get("q") for x in base.get("list") or []}
    for t in base.get("trades") or []:
        k = vkey(t[4], t[2], t[3])
        if k in ver or _day_ts(t[0]) < since:
            continue
        x = by.get((int(t[4]), t[2], int(t[3])))
        want.setdefault(int(t[4]), {})[k] = dict(x, name=t[2]) if x else {"name": t[2], "dir": "long" if t[3] > 0 else "short",
                                                                           "quote": q.get((int(t[4]), t[2], int(t[3]))) or ""}
    usage, n, bad = {"in": 0, "out": 0}, 0, 0
    for post, its in sorted(want.items())[-VER_MAX:]:  # newest first matter most; the rest is checked on the next run
        p = post_of(S["ch"], post)
        if not p:
            log("  %s #%d: post not found, left unchecked" % (key, post))
            continue
        keys = list(its)
        try:
            res = verify_post(client, S["ch"], p, [its[k] for k in keys], usage)
        except Exception as e:  # noqa  # this post stays unchecked (out of the ranking) until the next run; go on with the rest
            log("  %s #%d: second check failed: %s" % (key, post, str(e)[:160]))
            bad += 1
            if bad >= 3:  # the API is down or the key is wrong: stop paying for this channel, the next run tries again
                raise
            continue
        bad = 0
        for k, c in zip(keys, res):
            if c:
                ver[k] = {"v": c["verdict"], "why": c["why"][:200], "entry": c["entry"], "targets": c["targets"], "stop": c["stop"], "m": VER_MODEL}
                n += 1
        time.sleep(0.3)
    if n:
        log("%s: second check of %d ideas: %d drop, %d fix, $%.2f" % (key, n, sum(1 for v in ver.values() if v["v"] == "drop"),
                                                                    sum(1 for v in ver.values() if v["v"] == "fix"), usage["in"] / 1e6 * price_of(VER_MODEL)[0] + usage["out"] / 1e6 * price_of(VER_MODEL)[1]))
    return n


def apply_ver(S, base, now):
    """Apply the second check: dropped ideas become kind "ver" (not counted), fixed ones get the corrected levels and are judged
    again; base trades are dropped or re-judged, and the base money and counts change by the difference. Returns the new base."""
    ver = S.get("ver") or {}
    for x in S["ideas"]:
        v = ver.get(vkey(x["post"], _nm(x), 1 if x["dir"] == "long" else -1))
        if not v:
            continue
        if v["v"] == "drop" and x.get("kind") != "ver":
            x["kind0"], x["kind"] = x.get("kind") or "new", "ver"
        elif v["v"] == "fix" and not x.get("vfix"):
            x.update(entry=v["entry"], targets=v["targets"] or [], stop=v["stop"], vfix=1)
            x.pop("fin", None)  # judge again with the corrected levels
    b = json.loads(json.dumps(base))
    by = {(x["post"], _nm(x), 1 if x["dir"] == "long" else -1): x for x in S["ideas"]}
    trades, d_bank, d_w, d_l, drop = [], 0.0, 0, 0, 0
    for t in b.get("trades") or []:
        v = ver.get(vkey(t[4], t[2], t[3]))
        new = t
        if v and v["v"] == "drop":
            new = None
        elif v and v["v"] == "fix":
            x = by.get((int(t[4]), t[2], int(t[3])))
            if x:
                r, pct, ex = judge2(dict(x, entry=v["entry"], targets=v["targets"] or [], stop=v["stop"]), now)
                if r in ("win", "loss", "flat") and pct is not None:
                    sgn = pct if t[3] > 0 else -pct
                    new = [_ds(ex), round(max(-STAKE, STAKE * sgn / 100), 2)] + list(t[2:])
                elif r != "open":
                    new = None  # untriggered at the corrected entry, or no data: the follower never entered
        if new is t:
            trades.append(t)
            continue
        d_bank -= t[1]
        d_w -= t[1] > 0
        d_l -= t[1] < 0
        if new:
            trades.append(new)
            d_bank += new[1]
            d_w += new[1] > 0
            d_l += new[1] < 0
        else:
            drop += 1
    if trades != (b.get("trades") or []):
        b["trades"] = sorted(trades, key=lambda t: t[0])
        b["bank"] = round(max(0, float(b.get("bank") or 0) + d_bank), 2)
        b["pnl"] = round(b["bank"] - 1000, 2)
        b["win"], b["loss"] = max(0, (b.get("win") or 0) + d_w), max(0, (b.get("loss") or 0) + d_l)
        b["followed"] = max(0, (b.get("followed") or 0) - drop)
    return b


def vercal(models):
    """history.py vercal m1,m2 : re-ask a cheaper model about posts the Sonnet second check already judged and print how often they agree.
    Nothing is written to the store. HIST_CAL_POSTS (default 150) posts are drawn at random (fixed seed) across all channels."""
    import random
    from concurrent.futures import ThreadPoolExecutor
    st = json.load(open(STORE, encoding="utf-8"))
    jobs = []
    for key, S in st["ch"].items():
        ver = {k: v for k, v in (S.get("ver") or {}).items() if not v.get("m") or v["m"].startswith("claude-sonnet")}
        if not ver:
            continue
        items = {}
        for x in S["ideas"]:
            items[vkey(x["post"], _nm(x), 1 if x["dir"] == "long" else -1)] = dict(x, name=_nm(x))
        by = {(x["post"], _nm(x), 1 if x["dir"] == "long" else -1): x for x in S["ideas"]}
        q = {(x["n"], x["c"], 1 if x["s"] == "l" else -1): x.get("q") for x in (S["base"].get("list") or [])}
        for t in S["base"].get("trades") or []:
            k = vkey(t[4], t[2], t[3])
            if k not in items:
                x = by.get((int(t[4]), t[2], int(t[3])))
                items[k] = dict(x, name=t[2]) if x else {"name": t[2], "dir": "long" if t[3] > 0 else "short", "quote": q.get((int(t[4]), t[2], int(t[3]))) or ""}
        posts = {}
        for k in ver:
            if k in items:
                posts.setdefault(int(k.split(":")[0]), []).append(k)
        jobs += [(key, S["ch"], n, ks, ver) for n, ks in posts.items()]
    random.Random(7).shuffle(jobs)
    jobs = jobs[:int(os.environ.get("HIST_CAL_POSTS") or 150)]
    log("calibration: %d posts, %d Sonnet verdicts" % (len(jobs), sum(len(j[3]) for j in jobs)))
    out = {}
    for model in models:
        usage, rows, fails = {"in": 0, "out": 0}, [], 0

        def one(j):
            key, ch, n, ks, ver = j
            p = post_of(ch, n)
            if not p:
                return []
            its = []
            for k in ks:
                S = st["ch"][key]
                x = next((dict(x, name=_nm(x)) for x in S["ideas"] if vkey(x["post"], _nm(x), 1 if x["dir"] == "long" else -1) == k), None)
                if not x:
                    nm, sd = k.split(":")[1], int(k.split(":")[2])
                    x = {"name": nm, "dir": "long" if sd > 0 else "short", "quote": ""}
                its.append(x)
            res = verify_post(None, ch, p, its, usage, model)
            return [(ver[k]["v"], (c or {}).get("verdict")) for k, c in zip(ks, res)]
        with ThreadPoolExecutor(6) as ex:
            for r in ex.map(lambda j: _safe(one, j), jobs):
                if r is None:
                    fails += 1
                else:
                    rows += r
        pairs = [(a, b) for a, b in rows if b]
        same = sum(a == b for a, b in pairs)
        cnt = sum((a != "drop") == (b != "drop") for a, b in pairs)
        conf = {}
        for a, b in pairs:
            conf["%s>%s" % (a, b)] = conf.get("%s>%s" % (a, b), 0) + 1
        pi, po = price_of(model)
        cost = usage["in"] / 1e6 * pi + usage["out"] / 1e6 * po
        per_post = cost / max(1, len(jobs) - fails)
        out[model] = {"verdicts": len(pairs), "exact": round(same / max(1, len(pairs)), 3), "counted_same": round(cnt / max(1, len(pairs)), 3),
                      "confusion": conf, "failed_posts": fails, "tokens_in": usage["in"], "tokens_out": usage["out"], "cost": round(cost, 3),
                      "full_history_estimate": round(per_post * 5100, 2)}
        log("%s: %s" % (model, json.dumps(out[model], ensure_ascii=False)))
    os.makedirs("out", exist_ok=True)
    json.dump(out, open("out/vercal.json", "w"), ensure_ascii=False, indent=1)
    return out


def veronly(keys=None):
    """history.py veronly [tg-a,..] : run only the second check (HIST_VER_MODEL, HIST_VER_DAYS) on the stored ideas and base trades and save
    the verdicts in the store. Reads no new posts and needs no Anthropic key, so it can run where only a cheaper model's key lives
    (ai-team-platform). The next «update» applies the verdicts to leaders_history.json."""
    from concurrent.futures import ThreadPoolExecutor
    st = json.load(open(STORE, encoding="utf-8"))
    want = [k for k in st["ch"] if not keys or k in keys]
    now = int(time.time())

    def one(k):
        try:
            return _verify(k, st["ch"][k], st["ch"][k]["base"], None, now)
        except Exception as e:  # noqa
            log("::warning::%s: second check failed: %s" % (k, str(e)[:200]))
            return 0
    with ThreadPoolExecutor(WORKERS) as ex:
        n = sum(ex.map(one, want))
    json.dump(st, open(STORE, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    log("veronly: %d ideas checked with %s" % (n, VER_MODEL))
    return n


def _safe(f, j):
    try:
        return f(j)
    except Exception as e:  # noqa
        log("  calibration post failed: %s" % str(e)[:200])
        return None


def update(keys=None, novr=False):
    """history.py update [tg-a,tg-b]: refresh leaders_history.json from the posts since the last run (see the note above)."""
    import anthropic
    from concurrent.futures import ThreadPoolExecutor
    LHd = json.load(open(LH, encoding="utf-8"))
    try:
        st = json.load(open(STORE, encoding="utf-8"))
    except FileNotFoundError:
        st = {"_doc": "Raw method-2 ideas after each channel's frozen base record (ops/history.py update). base = the record of the "
                      "2026-11-13 recount, cut = when it was made, last/lt = the newest post read.", "ch": {}}
    for k, H in LHd["leaders"].items():
        if k in st["ch"] or not isinstance(H, dict) or H.get("m") != METHOD or not k.startswith("tg-"):
            continue
        st["ch"][k] = {"ch": H.get("ch") or k[3:], "mkt": "stocks" if H.get("mkt") == "stocks" else "crypto",
                       "cut": _day_ts(H["upd"]) + DAY, "base": H, "last": 0, "posts": 0, "read": 0, "ideas": []}
    want = [k for k in st["ch"] if not keys or k in keys]
    client = anthropic.Anthropic(max_retries=8)

    def one(k):
        try:
            got = _read_new(k, st["ch"][k], client)
        except Exception as e:  # noqa
            log("::warning::%s: read failed, kept as it was: %s" % (k, str(e)[:200]))
            got = None
        if got is None:  # still check the ideas read before
            if not novr:
                try:
                    _verify(k, st["ch"][k], st["ch"][k]["base"], client, int(time.time()))
                except Exception as e:  # noqa
                    log("::warning::%s: second check failed: %s" % (k, str(e)[:200]))
            return k, None
        if not novr:  # the second check runs here, so the channels are checked in parallel within the job time limit
            S = st["ch"][k]
            S["ideas"] += [{f: v for f, v in x.items() if f != "img"} for x in got[2]]
            try:
                _verify(k, S, S["base"], client, int(time.time()))
            except Exception as e:  # noqa  # ideas not yet checked stay out of the ranking (winners.py)
                log("::warning::%s: second check failed: %s" % (k, str(e)[:200]))
            got = (got[0], got[1], [])
        return k, got
    with ThreadPoolExecutor(WORKERS) as ex:
        got = dict(ex.map(one, want))
    now, ok = int(time.time()), 0
    for k in want:
        S = st["ch"][k]
        if got.get(k):
            posts, cand, ideas = got[k]
            S["ideas"] += [{f: v for f, v in x.items() if f != "img"} for x in ideas]
            if posts:
                S["last"], S["lt"] = max(p["n"] for p in posts), max(p["t"] for p in posts)
            elif not S.get("lt"):
                S["lt"] = now - DAY  # nothing new on the first read: start from here
            S["posts"] += len(posts)
            S["read"] += len(cand)
        try:
            base = apply_ver(S, S["base"], now)
            counted, res, money, bank = settle_after(base, S["ideas"], S["cut"], now)
            LHd["leaders"][k] = merge(base, counted, res, money, bank, S["posts"], S["read"])
            LHd["leaders"][k]["ver"] = sorted(kk for kk, v in (S.get("ver") or {}).items() if v["v"] != "drop")
            ok += 1
            log("%s: +%d counted %s, %d trades, bank %s" % (k, len(counted), res, len(money), LHd["leaders"][k].get("bank")))
        except Exception as e:  # noqa
            log("::warning::%s: settle failed, record kept: %s" % (k, e))
    for x in (x for S in st["ch"].values() for x in S["ideas"]):
        for f in ("res", "pct", "exit", "pnl"):
            x.pop(f, None)  # only the final verdict (fin) is kept
    LHd["upd"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for path, d in ((STORE, st), (LH, LHd)):
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(path + ".tmp", path)
    fails = len(want) - ok + sum(1 for k in want if not got.get(k))
    log("%supdate: %d of %d channels refreshed, %d read or settle failures" % ("::warning::" if fails else "", ok, len(want), fails))
    unread = sum(1 for k in want if not got.get(k))
    return ok if unread * 2 <= len(want) else 0  # most channels unread (Claude key, API down): fail the run so it is seen


def main():
    if sys.argv[1] == "vercal":  # history.py vercal gemini-2.5-flash-lite,gpt-5-mini : agreement with the Sonnet verdicts, no writes
        vercal([m.strip() for m in sys.argv[2].split(",") if m.strip()])
        sys.exit(0)
    if sys.argv[1] == "veronly":
        veronly([k.strip() for k in sys.argv[2].split(",") if k.strip()] if len(sys.argv) > 2 else None)
        sys.exit(0)
    if sys.argv[1] == "update":  # history.py update [tg-a,tg-b] : the daily refresh of leaders_history.json
        sys.exit(0 if update([k.strip() for k in sys.argv[2].split(",") if k.strip()] if len(sys.argv) > 2 else None) else 1)
    if sys.argv[1] == "rejudge":  # history.py rejudge <history-ch.json>... : print each channel's site record, key tg-<channel>
        now = int(time.time())
        for path in sys.argv[2:]:
            summ, ideas = rejudge(path, now)
            print(TG.key_of(summ["channel"]), json.dumps(pack(summ["channel"], summ, ideas), ensure_ascii=False, separators=(",", ":")))
        return
    out_dir, chans = sys.argv[1], [c.strip() for c in sys.argv[2].split(",") if c.strip()]
    os.makedirs(out_dir, exist_ok=True)
    import anthropic
    client = anthropic.Anthropic(max_retries=8)  # many channels run in parallel: wait out rate limits
    now = int(time.time())
    for c in chans:
        try:
            run(c, client, out_dir, now)
        except Exception as e:  # noqa
            log("%s failed: %s" % (c, e))


if __name__ == "__main__":
    main()
