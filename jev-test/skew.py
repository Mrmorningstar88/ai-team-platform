"""Albert Wang idea on crypto: 1-month price move vs options skew (Deribit). Skew per day =
median IV of OTM puts (strike 80-95% of index) minus median IV of OTM calls (105-120%), expiries 7-60 days,
from Deribit option trades 06:00-10:00 UTC. Quadrants: contrarian bid (price down, calls bid = skew low),
fear (down, puts bid), chase (up, calls bid), hedged rally (up, puts bid). Paper only."""
import json, sys, time, urllib.request, datetime as dt, statistics as st, io, zipfile, random
COIN=sys.argv[1] if len(sys.argv)>1 else "BTC"
API="https://history.deribit.com/api/v2/public/get_last_trades_by_currency_and_time"
MON={m:i+1 for i,m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
def get(url):
    for k in range(5):
        try: return json.loads(urllib.request.urlopen(url,timeout=30).read())
        except Exception as ex: time.sleep(2*(k+1)); err=ex
    print("fail",url,err); return None
def exp_ts(s):
    d=int(s[:-5]); m=MON[s[-5:-2]]; y=2000+int(s[-2:])
    return dt.datetime(y,m,d,8,tzinfo=dt.timezone.utc).timestamp()
day=dt.date(2021,1,1); end=dt.date(2026,11,1); skew={}
t0=time.time()
while day<end:
    a=int(dt.datetime(day.year,day.month,day.day,6,tzinfo=dt.timezone.utc).timestamp()*1000); b=a+4*3600*1000
    puts=[];calls=[]; s=a
    for page in range(8):
        j=get(f"{API}?currency={COIN}&kind=option&start_timestamp={s}&end_timestamp={b}&count=1000&sorting=asc")
        if not j: break
        tr=j["result"]["trades"]
        for x in tr:
            try:
                _,ex,k,cp=x["instrument_name"].split("-"); k=float(k); S=x["index_price"]; iv=x["iv"]
                dte=(exp_ts(ex)-x["timestamp"]/1000)/86400
            except Exception: continue
            if not (7<=dte<=60) or not iv: continue
            mny=k/S
            if cp=="P" and 0.80<=mny<=0.95: puts.append(iv)
            if cp=="C" and 1.05<=mny<=1.20: calls.append(iv)
        if not j["result"].get("has_more") or not tr: break
        s=tr[-1]["timestamp"]+1
    if len(puts)>=3 and len(calls)>=3: skew[day.isoformat()]=st.median(puts)-st.median(calls)
    day+=dt.timedelta(days=1)
    if day.day==1: print(day, len(skew), "days with skew, %.0fs"%(time.time()-t0), flush=True)
json.dump(skew,open(f"skew_{COIN}.json","w"))
# daily closes, Binance spot
px={}
for y in range(2020,2027):
    for m in range(1,13):
        if (y,m)>(2026,10) or (y,m)<(2020,11): continue
        u=f"https://data.binance.vision/data/spot/monthly/klines/{COIN}USDT/1d/{COIN}USDT-1d-{y}-{m:02d}.zip"
        z=zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(u,timeout=60).read()))
        for r in z.read(z.namelist()[0]).decode().splitlines():
            p=r.split(",")
            if not p[0].isdigit(): continue
            t=int(p[0]); t=t//1000 if t>1e14 else t
            px[dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).date().isoformat()]=float(p[4])
days=sorted(d for d in px if d in skew)
print(COIN,"days with price+skew:",len(days),days[0] if days else None,days[-1] if days else None)
allp=sorted(px)
def ret(d,n):
    i=allp.index(d)
    if i-n<0: return None
    return px[d]/px[allp[i-n]]-1
def fwd(d,n):
    i=allp.index(d)
    if i+n>=len(allp): return None
    return px[allp[i+n]]/px[d]-1
# skew relative to its own last 90 days (z-score) so slow drifts don't decide
def q_of(skz,r30):
    if r30<0 and skz<-0.5: return "contrarian_bid"
    if r30<0 and skz>0.5: return "fear"
    if r30>=0 and skz<-0.5: return "chase"
    if r30>=0 and skz>0.5: return "hedged_rally"
    return "middle"
rows=[]
for i,d in enumerate(days):
    hist=[skew[x] for x in days[max(0,i-90):i]]
    r30=ret(d,30)
    if len(hist)<60 or r30 is None: continue
    m=st.mean(hist); sd=st.pstdev(hist) or 1e-9
    rows.append((d,(skew[d]-m)/sd,r30))
def report(rows,tag):
    print("--",tag)
    for H in (5,10,20):
        base=[fwd(d,H) for d,_,_ in rows if fwd(d,H) is not None]
        line=["all %+.2f%%"%(100*st.mean(base))]
        for q in ("contrarian_bid","fear","chase","hedged_rally"):
            v=[fwd(d,H) for d,z,r in rows if q_of(z,r)==q and fwd(d,H) is not None]
            if v: line.append("%s n=%d %+.2f%% up %.0f%%"%(q,len(v),100*st.mean(v),100*sum(x>0 for x in v)/len(v)))
        print("next %dd:"%H," | ".join(line))
    # trade rule: go long on contrarian bid, hold until hedged rally or fear; fee 0.1% per side
    def strat(rows):
        eq=1.0;pos=0;n=0
        for k in range(len(rows)-1):
            d,z,r=rows[k]; q=q_of(z,r)
            new = 1 if q=="contrarian_bid" else (0 if q in ("fear","hedged_rally") else pos)
            if new!=pos: eq*=0.999; n+=1
            pos=new
            nd=rows[k+1][0]; eq*=1+pos*(px[nd]/px[d]-1)
        return eq-1,n
    r,n=strat(rows); hold=px[rows[-1][0]]/px[rows[0][0]]-1
    print("rule long on contrarian bid, exit on fear/hedged rally: %+.1f%% (%d switches) vs hold %+.1f%%"%(100*r,n,100*hold))
    return r
report(rows,"full period")
half=len(rows)//2
report(rows[:half],"first half"); report(rows[half:],"second half")
# placebo: same rule with skew shuffled 200 times
random.seed(7); zs=[z for _,z,_ in rows]; better=0; real=None
import contextlib, os
with contextlib.redirect_stdout(open(os.devnull,"w")):
    real=report(rows,"x")
    for k in range(200):
        random.shuffle(zs)
        if report([(d,zs[i],r) for i,(d,_,r) in enumerate(rows)],"p")>=real: better+=1
print("placebo: shuffled skew did as well or better in %d of 200 runs"%better)
