"""Our bot with vs without OpenBB data (paper only).

Bot = the live daily trend blend (20 long-only rules on BTC, exposure 0..1, copied from trend-terminal strategy.py).
OpenBB adds CFTC Commitments of Traders for CME Bitcoin futures (weekly, as of Tuesday, published Friday;
used from the next Saturday so nothing is seen early). Pre-registered filters, no tuning:
  A  asset managers adding: AM net long rose over 4 weeks -> keep exposure, else 0
  B  half-size when fall: same as A but 0.5x instead of 0
  C  crowded hedge funds: leveraged funds net long z-score (52w) > 1 -> half exposure
  D  hedge funds covering: leveraged net 4w change > 0 -> keep, else 0
Fee 0.1% per unit of exposure change. Periods: full 2019-2026 and both halves.
"""
import io, json, sys, zipfile
import numpy as np, pandas as pd, requests
sys.path.insert(0, "jev-test")
from trend_strategy import rules

def btc_daily():
    frames = []
    for y in range(2018, 2027):
        for m in range(1, 13):
            if (y, m) > (2026, 10):
                break
            u = f"https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1d/BTCUSDT-1d-{y}-{m:02d}.zip"
            r = requests.get(u, timeout=60)
            if r.status_code != 200:
                continue
            z = zipfile.ZipFile(io.BytesIO(r.content))
            f = pd.read_csv(z.open(z.namelist()[0]), header=None)
            frames.append(f.iloc[:, :5])
    d = pd.concat(frames)
    d.columns = ["t", "open", "high", "low", "close"]
    t = d["t"].astype("int64")
    t = np.where(t > 1e14, t // 1000, t)  # 2025+ files are in microseconds
    d.index = pd.to_datetime(t, unit="ms").normalize()
    return d[["open", "high", "low", "close"]].astype(float).sort_index().loc[lambda x: ~x.index.duplicated()]

def cot():
    src = "openbb"
    try:
        from openbb import obb
        df = obb.regulators.cftc.cot(id="133741", report_type="tff", futures_only=True,
                                     start_date="2017-12-01", end_date="2026-11-13").to_df()
    except Exception as e:
        print("openbb cot failed, using CFTC API directly:", repr(e)[:300])
        src = "cftc"
        r = requests.get("https://publicreporting.cftc.gov/resource/gpe5-46if.json",
                         params={"cftc_contract_market_code": "133741", "$limit": 5000}, timeout=60)
        df = pd.DataFrame(r.json())
    df = df.reset_index()
    print("COT source", src, "rows", len(df), "columns", list(df.columns)[:60])
    cols = {c.lower(): c for c in df.columns}
    def find(*words, no=()):
        for lc, c in cols.items():
            if all(w in lc for w in words) and not any(n in lc for n in no):
                return c
        raise KeyError(words)
    date = find("date", no=("cftc",)) if any("report_date" in c for c in cols) is False else find("report_date")
    am_l, am_s = find("asset_mgr", "long", no=("pct", "change", "spread", "trader")), find("asset_mgr", "short", no=("pct", "change", "spread", "trader"))
    lv_l, lv_s = find("lev", "long", no=("pct", "change", "spread", "trader")), find("lev", "short", no=("pct", "change", "spread", "trader"))
    print("using", date, am_l, am_s, lv_l, lv_s)
    out = pd.DataFrame({"am": pd.to_numeric(df[am_l]) - pd.to_numeric(df[am_s]),
                        "lev": pd.to_numeric(df[lv_l]) - pd.to_numeric(df[lv_s])})
    out.index = pd.to_datetime(df[date]).dt.tz_localize(None).dt.normalize()
    return out.sort_index().loc[lambda x: ~x.index.duplicated()], src

px = btc_daily()
print("BTC days", len(px), px.index[0].date(), px.index[-1].date())
base = rules(px).mean(axis=1)
c, src = cot()
c["am4"] = c["am"].diff(4)
c["lev4"] = c["lev"].diff(4)
c["levz"] = (c["lev"] - c["lev"].rolling(52).mean()) / c["lev"].rolling(52).std()
c.index = c.index + pd.Timedelta(days=4)  # Tuesday data usable from Saturday
cd = c.reindex(px.index, method="ffill")
filters = {
    "bot (no OpenBB)": base,
    "A asset managers adding": base * (cd["am4"] > 0),
    "B half when not adding": base * np.where(cd["am4"] > 0, 1, 0.5),
    "C half when funds crowded": base * np.where(cd["levz"] > 1, 0.5, 1),
    "D hedge funds covering": base * (cd["lev4"] > 0),
}
ret = px["close"].pct_change().fillna(0)
def stats(expo, a, b):
    e = expo.shift(1).fillna(0)  # decide on close, hold next day
    r = (e * ret - 0.001 * e.diff().abs().fillna(0)).loc[a:b]
    eq = (1 + r).cumprod()
    dd = (eq / eq.cummax() - 1).min()
    sh = r.mean() / r.std() * np.sqrt(365) if r.std() else 0
    return dict(ret=round(float(eq.iloc[-1] - 1) * 100, 1), maxdd=round(float(dd) * 100, 1), sharpe=round(float(sh), 2),
                time_in=round(float((e.loc[a:b] > 0).mean()) * 100))
periods = {"2019-2026": ("2019-01-01", "2026-10-31"), "2019-2022": ("2019-01-01", "2022-12-31"), "2023-2026": ("2023-01-01", "2026-10-31")}
res = {"cot_source": src}
for p, (a, b) in periods.items():
    hold = (1 + ret.loc[a:b]).cumprod()
    res[p] = {"buy&hold": dict(ret=round(float(hold.iloc[-1] - 1) * 100, 1), maxdd=round(float((hold / hold.cummax() - 1).min()) * 100, 1))}
    for k, v in filters.items():
        res[p][k] = stats(v, a, b)
for p in periods:
    print("\n==", p)
    for k, v in res[p].items():
        print(f"  {k:28s} {v}")
json.dump(res, open("openbb_cot.json", "w"), indent=1)
