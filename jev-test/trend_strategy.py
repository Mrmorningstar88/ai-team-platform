"""Daily trend blend: 20 long-only rules on daily BTC candles, averaged into a target exposure 0..1.

Same rules as the VectorBT research (framework-shootout/vec.py), daily timeframe only.
"""
import numpy as np
import pandas as pd

MIN_DAYS = 220  # longest lookback is 200 days


def _hold(entry, exit_):
    out = np.zeros(len(entry)); st = 0
    for i, (e, x) in enumerate(zip(entry.values, exit_.values, strict=True)):
        if st == 0 and e: st = 1
        elif st == 1 and x: st = 0
        out[i] = st
    return pd.Series(out, index=entry.index)


def rules(df: pd.DataFrame) -> pd.DataFrame:
    """df: daily candles with columns open, high, low, close (closed candles only, oldest first)."""
    c, h, l = df["close"], df["high"], df["low"]
    r = {}
    for n in (20, 30, 50, 75, 100, 150, 200):
        r[f"Price above {n}-day average"] = c > c.rolling(n).mean()
    for f, s in ((10, 30), (20, 50), (20, 100), (50, 200)):
        r[f"{f}/{s}-day EMA cross"] = c.ewm(span=f, adjust=False).mean() > c.ewm(span=s, adjust=False).mean()
    for n in (14, 30, 60, 90, 180):
        r[f"{n}-day momentum"] = c > c.shift(n)
    for en, ex in ((20, 10), (55, 20), (100, 50)):
        r[f"{en}/{ex}-day breakout"] = _hold(c > h.rolling(en).max().shift(1), c < l.rolling(ex).min().shift(1)) > 0
    r["Above 50 and 200-day averages"] = (c > c.rolling(50).mean()) & (c > c.rolling(200).mean())
    return pd.DataFrame(r).astype(float)


def target_exposure(df: pd.DataFrame) -> dict:
    """Target BTC exposure (0..1 of equity) from the latest closed daily candle."""
    if len(df) < MIN_DAYS:
        raise ValueError(f"need at least {MIN_DAYS} daily candles, got {len(df)}")
    R = rules(df)
    last = R.iloc[-1]
    return {"exposure": float(last.mean()), "bullish": int(last.sum()), "total": len(last),
            "rules": {k: bool(v) for k, v in last.items()}, "as_of": str(df.index[-1])}


def explain(df: pd.DataFrame) -> list:
    """Each rule at the latest closed candle, in plain words, with how far it is from flipping (gap, % of price)."""
    c, h, l = df["close"], df["high"], df["low"]
    p = float(c.iloc[-1]); out = []
    usd = lambda v: f"${v:,.0f}"
    on = rules(df).iloc[-1]
    for n in (20, 30, 50, 75, 100, 150, 200):
        ma = float(c.rolling(n).mean().iloc[-1])
        out.append({"group": "avg", "name": f"Above {n}-day average", "on": bool(on[f"Price above {n}-day average"]),
                    "gap": p / ma - 1, "text": f"price {usd(p)} vs {n}-day average {usd(ma)}"})
    for f, s in ((10, 30), (20, 50), (20, 100), (50, 200)):
        ef, es = float(c.ewm(span=f, adjust=False).mean().iloc[-1]), float(c.ewm(span=s, adjust=False).mean().iloc[-1])
        out.append({"group": "ema", "name": f"{f}-day over {s}-day EMA", "on": bool(on[f"{f}/{s}-day EMA cross"]),
                    "gap": ef / es - 1, "text": f"{f}-day trend {usd(ef)} vs {s}-day trend {usd(es)}"})
    for n in (14, 30, 60, 90, 180):
        then = float(c.iloc[-1 - n])
        out.append({"group": "mom", "name": f"Up over {n} days", "on": bool(on[f"{n}-day momentum"]),
                    "gap": p / then - 1, "text": f"price {usd(p)} vs {usd(then)} {n} days ago"})
    for en, ex in ((20, 10), (55, 20), (100, 50)):
        hi, lo = float(h.rolling(en).max().iloc[-2]), float(l.rolling(ex).min().iloc[-2])
        o = bool(on[f"{en}/{ex}-day breakout"])
        out.append({"group": "brk", "name": f"{en}-day breakout", "on": o, "gap": (p / lo - 1) if o else (p / hi - 1),
                    "text": (f"in a breakout; exits if price closes below {usd(lo)} ({ex}-day low)" if o
                             else f"waiting; buys if price closes above {usd(hi)} ({en}-day high)")})
    m50, m200 = float(c.rolling(50).mean().iloc[-1]), float(c.rolling(200).mean().iloc[-1])
    out.append({"group": "avg", "name": "Above 50 and 200-day", "on": bool(on["Above 50 and 200-day averages"]),
                "gap": p / max(m50, m200) - 1, "text": f"price {usd(p)} vs 50-day {usd(m50)} and 200-day {usd(m200)}"})
    for r in out: r["gap"] = round(float(r["gap"]), 4)
    return out
