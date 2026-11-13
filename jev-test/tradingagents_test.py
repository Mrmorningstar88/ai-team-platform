"""Paper test of TauricResearch/TradingAgents on crypto (no orders anywhere).

Time machine: every 5 days the agent team decides on date d using only data up
to d (TradingAgents point-in-time mode). We score the call ourselves from the
close of d+1 to the close of d+6, so windows chain without overlap and form an
equity curve. Buy=+1, Overweight=+0.5, Hold=0, Underweight=-0.5, Sell=-1;
fee 0.1% per unit of position change. Scenarios: each window is tagged by the
coin's prior 30-day trend (up > +5%, down < -5%, else sideways).
"""
import json, os, sys, time, traceback
from datetime import datetime, timedelta

import yfinance as yf
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.graph.trading_graph import TradingAgentsGraph

COIN = os.environ["COIN"]            # BTC / ETH / SOL
MODEL = os.environ["MODEL_TAG"]      # grok / openai
START = os.environ.get("START", "2026-06-01")
END = os.environ.get("END", "2026-11-03")
STEP = int(os.environ.get("STEP", "5"))
FEE = 0.001
POS = {"Buy": 1.0, "Overweight": 0.5, "Hold": 0.0, "Underweight": -0.5, "Sell": -1.0}
ticker = f"{COIN}-USD"

cfg = DEFAULT_CONFIG.copy()
if MODEL == "grok":
    cfg.update(llm_provider="xai", deep_think_llm=os.environ.get("XAI_MODEL") or "grok-4.6",
               quick_think_llm=os.environ.get("XAI_MODEL") or "grok-4.6")
else:
    cfg.update(llm_provider="openai", deep_think_llm="gpt-6-luna", quick_think_llm="gpt-6-luna")
cfg.update(results_dir=f"/tmp/ta_{MODEL}_{COIN}", memory_log_path=f"/tmp/ta_{MODEL}_{COIN}/mem.md",
           data_cache_dir=f"/tmp/ta_cache_{COIN}", llm_max_retries=6)

px = yf.download(ticker, start="2026-04-01", end="2026-11-13", interval="1d", progress=False, auto_adjust=True)
close = px["Close"].squeeze()
close.index = close.index.strftime("%Y-%m-%d")
closes = close.to_dict()

def c(day):
    return closes.get(day.strftime("%Y-%m-%d"))

graph = TradingAgentsGraph(("market", "news"), config=cfg)
d = datetime.strptime(START, "%Y-%m-%d")
end = datetime.strptime(END, "%Y-%m-%d")
rows = []
while d <= end:
    ds = d.strftime("%Y-%m-%d")
    t0 = time.time()
    try:
        _, rating = graph.propagate(ticker, ds, "crypto")
    except Exception as exc:
        traceback.print_exc()
        rating = "ERROR"
    entry, exit_, past = c(d + timedelta(days=1)), c(d + timedelta(days=STEP + 1)), c(d - timedelta(days=30))
    now = c(d)
    ret = (exit_ / entry - 1) if entry and exit_ else None
    trend = (now / past - 1) if now and past else None
    regime = None if trend is None else ("up" if trend > 0.05 else "down" if trend < -0.05 else "sideways")
    rows.append(dict(date=ds, rating=rating, ret=ret, regime=regime, secs=round(time.time() - t0)))
    print(f"{ds} {rating:11s} next5d={ret if ret is None else round(ret*100,2)}% regime={regime} ({rows[-1]['secs']}s)", flush=True)
    d += timedelta(days=STEP)

eq, hold, prev = 1.0, 1.0, 0.0
by_reg = {}
calls = {"hit": 0, "miss": 0}
for r in rows:
    pos = POS.get(r["rating"], 0.0)
    if r["ret"] is None:
        continue
    pnl = pos * r["ret"] - FEE * abs(pos - prev)
    prev = pos
    eq *= 1 + pnl
    hold *= 1 + r["ret"]
    g = by_reg.setdefault(r["regime"], {"n": 0, "agent": 0.0, "hold": 0.0})
    g["n"] += 1; g["agent"] += pnl; g["hold"] += r["ret"]
    if pos:
        calls["hit" if pos * r["ret"] > 0 else "miss"] += 1
counts = {k: sum(1 for r in rows if r["rating"] == k) for k in set(r["rating"] for r in rows)}
out = dict(coin=COIN, model=MODEL, start=START, end=END, cells=len(rows), ratings=counts,
           agent_return=eq - 1, hold_return=hold - 1, direction_calls=calls,
           by_regime={k: {kk: (round(vv, 4) if isinstance(vv, float) else vv) for kk, vv in v.items()} for k, v in by_reg.items()},
           rows=rows)
print("RESULT", json.dumps({k: v for k, v in out.items() if k != "rows"}))
json.dump(out, open(f"ta_{MODEL}_{COIN}.json", "w"), indent=1)
