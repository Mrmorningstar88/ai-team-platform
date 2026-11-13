"""Jev (TypeSafe) on daily history, paper only: the same test as the /s AI tester on the terminal.

Each test day Jev sees the last 60 BloFin daily candles (no dates, no coin name, prices rescaled to 100) and picks
long, short or flat for the next day. Result after a 0.06% fee per side, against simply holding and against doing
the opposite. The key is the repository secret TYPESAFE_API_KEY; it is never printed.
"""
import calendar
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import ccxt

URL = "https://api.typesafe.ai/v1/systemone"
MODEL = os.environ.get("TYPESAFE_MODEL", "jev-latest")
KEY = os.environ.get("TYPESAFE_API_KEY", "").strip()
COIN = os.environ.get("COIN", "SOL")
SINCE = os.environ.get("SINCE", "2026-06-01")
WINDOW, MAX_DAYS, FEE = 60, 180, 0.0006
CRITERIA = {"long": "Price is more likely to rise tomorrow: hold a long position",
            "short": "Price is more likely to fall tomorrow: hold a short position",
            "flat": "No clear edge tomorrow: stay out of the market"}
USER = """Strategy: {rule}
Candles as [day, open, high, low, close, volume], oldest first; the last row is today, already closed:
{rows}
Position for tomorrow?"""


def ask(state: str) -> tuple[str | None, dict, str]:
    body = {"model": MODEL, "state": state, "questions": {"pos": {
        "type": "choice", "instructions": "Which position to hold for the next day", "criteria": CRITERIA}}}
    why = ""
    for n in range(4):
        req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST", headers={
            "Authorization": f"Bearer {KEY}", "content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:  # noqa: S310
                a = (json.load(r).get("answers") or {}).get("pos") or {}
            c = a.get("choice")
            return (c if c in CRITERIA else None), a.get("probabilities") or {}, "" if c in CRITERIA else f"odd answer {a}"[:120]
        except urllib.error.HTTPError as ex:
            why = f"HTTP {ex.code} {ex.read()[:200]!r}"
            if ex.code not in (408, 429, 500, 502, 503, 504, 529):
                return None, {}, why
        except Exception as ex:  # noqa: BLE001
            why = f"{type(ex).__name__}: {ex}"[:160]
        time.sleep((3, 10, 25, 25)[n])
    return None, {}, why


def masked(w: list) -> str:
    base = float(w[0][4]) or 1.0
    vb = (sum(float(b[5] or 0) for b in w) / len(w)) or 1.0
    return json.dumps([[i + 1] + [round(float(b[k]) / base * 100, 2) for k in (1, 2, 3, 4)] + [round(float(b[5] or 0) / vb * 100)]
                       for i, b in enumerate(w)], separators=(",", ":"))


def curve(ps: list, moves: list) -> dict:
    eq, top, worst, prev, held, right = 1.0, 1.0, 0.0, 0, 0, 0
    for p, m in zip(ps, moves, strict=False):
        k = {"long": 1, "short": -1}.get(p, 0)
        eq *= (1 - FEE) ** abs(k - prev) * (1 + k * m)
        held += bool(k)
        right += k * m > 0
        top = max(top, eq)
        worst = min(worst, eq / top - 1)
        prev = k
    return {"pct": round((eq - 1) * 100, 2), "max_drop_pct": round(worst * 100, 2), "days_in": held,
            "right_pct": round(100 * right / held, 1) if held else None}


def main() -> None:
    if not KEY:
        sys.exit("secret TYPESAFE_API_KEY is empty")
    pos, probs, why = ask(USER.format(rule="none", rows="[[1,100,103,99,102,100],[2,102,106,101,105,120]]"))
    print("live check:", pos, probs, why or "OK")
    if pos is None:
        sys.exit("Jev did not answer the live check")
    bars = ccxt.blofin().fetch_ohlcv(f"{COIN}/USDT:USDT", "1d", None, 300)
    today = calendar.timegm(time.gmtime()[:3] + (0, 0, 0))
    bars = [b for b in bars if b[0] // 1000 < today]
    t0 = calendar.timegm(time.strptime(SINCE, "%Y-%m-%d"))
    idx = [i for i, b in enumerate(bars) if b[0] // 1000 >= t0 and i >= WINDOW - 1 and i + 1 < len(bars)][:MAX_DAYS]
    moves = [bars[i + 1][4] / bars[i][4] - 1 for i in idx]
    state = "A trading bot tested on history. Strategy: none, use your own judgment\n"

    def one(i):
        return ask(state + USER.format(rule="none", rows=masked(bars[i - WINDOW + 1: i + 1])))
    with ThreadPoolExecutor(2) as ex:
        got = list(ex.map(one, idx))
    ps = [g[0] or "flat" for g in got]
    errs = [g[2] for g in got if g[0] is None]
    day = lambda i: time.strftime("%Y-%m-%d", time.gmtime(bars[i][0] // 1000))  # noqa: E731
    print(f"{COIN}: {len(idx)} days {day(idx[0])}..{day(idx[-1])}, no answer {len(errs)}", errs[:3])
    print("picks", {p: ps.count(p) for p in CRITERIA})
    flip = {"long": "short", "short": "long", "flat": "flat"}
    out = {"jev": curve(ps, moves), "jev_opposite": curve([flip[p] for p in ps], moves), "hold": curve(["long"] * len(moves), moves)}
    print("SUMMARY", json.dumps(out))
    sure = [max((g[1] or {}).values() or [0]) for g in got]
    print("mean top probability", round(sum(sure) / len(sure), 3))


if __name__ == "__main__":
    main()
