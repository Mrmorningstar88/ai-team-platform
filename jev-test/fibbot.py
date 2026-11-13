"""@_theautomationguy_ bot: 4H trend (HH+HL), 15m Fib pullback to 0.5 (cancel on close beyond 0.786),
15m close crosses 50 MA, SL 1% / TP 2%, max 5 trades/day, BTC+ETH. Their claim: Oct 2025-Oct 2026, 123 trades,
43% won, +23.7% no leverage after fees. We test the same year plus the year before. Paper only."""
import io, sys, urllib.request, zipfile
def month(sym, iv, ym):
    u=f"https://data.binance.vision/data/futures/um/monthly/klines/{sym}/{iv}/{sym}-{iv}-{ym}.zip"
    try: b=urllib.request.urlopen(u,timeout=90).read()
    except Exception as ex: print("miss",u,ex); return []
    z=zipfile.ZipFile(io.BytesIO(b)); out=[]
    for r in z.read(z.namelist()[0]).decode().splitlines():
        p=r.split(",")
        if not p[0].isdigit(): continue
        t=int(p[0]); t=t//1000 if t>1e14 else t
        out.append((t,float(p[1]),float(p[2]),float(p[3]),float(p[4])))
    return out
yms=[f"{y}-{m:02d}" for y in (2024,2025,2026) for m in range(1,13) if (2024,9)<=(y,m)<=(2026,10)]
def pivots(bars,k):
    hs=[];ls=[]
    for i in range(k,len(bars)-k):
        h=bars[i][2]; l=bars[i][3]
        if all(h>=bars[j][2] for j in range(i-k,i+k+1)): hs.append((i,h))
        if all(l<=bars[j][3] for j in range(i-k,i+k+1)): ls.append((i,l))
    return hs,ls
def trend_series(b4,k):
    hs,ls=pivots(b4,k); conf={}  # pivot i confirmed at bar i+k
    tr=[0]*len(b4); H=[];L=[]; hi=li=0
    for i in range(len(b4)):
        while hi<len(hs) and hs[hi][0]+k<=i: H.append(hs[hi][1]); hi+=1
        while li<len(ls) and ls[li][0]+k<=i: L.append(ls[li][1]); li+=1
        if len(H)>=2 and len(L)>=2:
            if H[-1]>H[-2] and L[-1]>L[-2]: tr[i]=1
            elif H[-1]<H[-2] and L[-1]<L[-2]: tr[i]=-1
    return tr
def backtest(sym,b15,b4,start,end,k4=2,k15=3,fee=0.0005,ma_n=50):
    tr4=trend_series(b4,k4); t4=[b[0] for b in b4]
    hs,ls=pivots(b15,k15)
    ma=[None]*len(b15); s=0
    for i,b in enumerate(b15):
        s+=b[4]
        if i>=ma_n: s-=b15[i-ma_n][4]
        if i>=ma_n-1: ma[i]=s/ma_n
    import bisect
    eq=1.0; trades=[]; pos=None; H=[];L=[]; hi=li=0; touched=None; daycount={}
    for i in range(ma_n,len(b15)):
        t,o,h,l,c=b15[i]
        while hi<len(hs) and hs[hi][0]+k15<=i: H.append(hs[hi]); hi+=1
        while li<len(ls) and ls[li][0]+k15<=i: L.append(ls[li]); li+=1
        if pos:
            side,ent,sl,tp=pos
            hit=None
            if side==1:
                if l<=sl: hit=sl
                elif h>=tp: hit=tp
            else:
                if h>=sl: hit=sl
                elif l<=tp: hit=tp
            if hit:
                r=side*(hit/ent-1)-2*fee; eq*=1+r; trades.append(r); pos=None
            continue
        if not (start<=t<end): continue
        j=bisect.bisect_right(t4,t-4*3600*1000)-1  # last CLOSED 4h bar
        if j<0: continue
        trd=tr4[j]
        if trd==0 or not H or not L: touched=None; continue
        if trd==1:
            lo=L[-1]; hi_=[x for x in H if x[0]>lo[0]]
            if not hi_: continue
            Hp=max(hi_,key=lambda x:x[1]); rng=Hp[1]-lo[1]
            if rng<=0: continue
            f5=Hp[1]-0.5*rng; f786=Hp[1]-0.786*rng
            key=(lo[0],Hp[0])
            if c<f786: touched=None; continue
            if l<=f5: touched=key
            if touched==key and b15[i-1][4]<=ma[i-1] and c>ma[i]:
                side=1
            else: continue
        else:
            hp=H[-1]; lo_=[x for x in L if x[0]>hp[0]]
            if not lo_: continue
            Lp=min(lo_,key=lambda x:x[1]); rng=hp[1]-Lp[1]
            if rng<=0: continue
            f5=Lp[1]+0.5*rng; f786=Lp[1]+0.786*rng
            key=(hp[0],Lp[0])
            if c>f786: touched=None; continue
            if h>=f5: touched=key
            if touched==key and b15[i-1][4]>=ma[i-1] and c<ma[i]:
                side=-1
            else: continue
        d=t//86400000
        if daycount.get(d,0)>=5: continue
        daycount[d]=daycount.get(d,0)+1
        pos=(side,c,c*(1-0.01*side),c*(1+0.02*side)); touched=None
    return eq,trades
import datetime as dt
def ms(s): return int(dt.datetime.strptime(s,"%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp()*1000)
data={}
for sym in ("BTCUSDT","ETHUSDT"):
    b15=[];b4=[]
    for ym in yms: b15+=month(sym,"15m",ym); b4+=month(sym,"4h",ym)
    data[sym]=(b15,b4); print(sym,len(b15),"15m bars",len(b4),"4h bars")
periods=[("THEIR YEAR 2025-10..2026-10","2025-10-01","2026-11-01"),("YEAR BEFORE 2024-10..2025-09","2024-10-01","2025-10-01")]
for name,a,b in periods:
    print("==",name)
    for fee in (0.0005,0.001):
      for k4,k15 in ((2,3),(3,3),(2,5),(3,5)):
        tot=[];res=[]
        for sym in data:
            eq,tr=backtest(sym,*data[sym],ms(a),ms(b),k4,k15,fee)
            tot+=tr; res.append((sym,eq))
        n=len(tot); w=sum(1 for r in tot if r>0)
        # both coins, half capital each, no leverage
        comb=sum(e for _,e in res)/2-1
        print("fee %.2f%% pivots4h=%d pivots15m=%d: trades %d, won %.0f%%, result %+.1f%% (%s)"%(fee*100,k4,k15,n,100*w/max(n,1),comb*100,", ".join("%s %+.1f%%"%(s[:3],(e-1)*100) for s,e in res)))
    for sym in data:
        b15=data[sym][0]; x=[r for r in b15 if ms(a)<=r[0]<ms(b)]
        print("hold",sym[:3],"%+.1f%%"%((x[-1][4]/x[0][1]-1)*100))
