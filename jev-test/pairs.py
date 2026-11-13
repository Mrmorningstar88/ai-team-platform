"""Pairs trading ETH/BTC (slide 7 of @artillerytrades: pairs trading is a good first one), daily, 0.1% fee per side,
2021-01..2026-10. In-sample sweep plus the first half / second half split. Paper only."""
import io, json, urllib.request, zipfile, math
def kl(sym, ym):
    u=f"https://data.binance.vision/data/spot/monthly/klines/{sym}/1d/{sym}-1d-{ym}.zip"
    b=urllib.request.urlopen(u,timeout=60).read()
    z=zipfile.ZipFile(io.BytesIO(b)); rows=z.read(z.namelist()[0]).decode().splitlines()
    return [(int(r.split(",")[0])//(1000 if len(r.split(",")[0])<16 else 1000000), float(r.split(",")[4])) for r in rows if r[0].isdigit()]
yms=[f"{y}-{m:02d}" for y in range(2021,2027) for m in range(1,13) if (y,m)<=(2026,10)]
d={}
for s in ("BTCUSDT","ETHUSDT"):
    out=[]
    for ym in yms: out+=kl(s,ym)
    d[s]=dict(out)
ts=sorted(set(d["BTCUSDT"])&set(d["ETHUSDT"]))
b=[d["BTCUSDT"][t] for t in ts]; e=[d["ETHUSDT"][t] for t in ts]
print(len(ts),"days")
FEE=0.001
def run(L,Z,start=0):
    eq=1.0;pos=0;tr=0;peak=1;dd=0
    for i in range(max(L,start),len(ts)-1):
        sp=[math.log(e[j]/b[j]) for j in range(i-L+1,i+1)]
        m=sum(sp)/L; sd=(sum((x-m)**2 for x in sp)/L)**.5 or 1e-9
        z=(sp[-1]-m)/sd
        new=pos
        if pos==0 and z>Z: new=-1
        elif pos==0 and z<-Z: new=1
        elif pos!=0 and abs(z)<0.2: new=0
        if new!=pos: eq*=(1-FEE)**(2*abs(new-pos)); tr+=1
        pos=new
        r=(e[i+1]/e[i]-1)-(b[i+1]/b[i]-1)
        eq*=1+pos*r*0.5  # 50% long one coin, 50% short the other
        peak=max(peak,eq); dd=min(dd,eq/peak-1)
    return eq-1,tr,dd
half=len(ts)//2
best=None
for L in (20,30,60,90):
    for Z in (1.5,2.0,2.5):
        r=run(L,Z); h2=run(L,Z,half)
        print(L,Z,"full %.1f%% trades %d dd %.1f%% | 2nd half only %.1f%%"%(r[0]*100,r[1],r[2]*100,h2[0]*100))
hold_b=b[-1]/b[0]-1; hold_e=e[-1]/e[0]-1
print("hold BTC %.0f%% ETH %.0f%%"%(hold_b*100,hold_e*100))
