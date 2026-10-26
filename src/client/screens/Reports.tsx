import { useEffect, useState } from "react";
import { useReducedMotion } from "../components/useReducedMotion";
import { DEMO_KPIS } from "../demo";

const COUNT_MS = 900;

function CountUp({ value, decimals }: { value: number; decimals: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) return setShown(value);
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      setShown(value * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return <>{shown.toLocaleString("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>;
}

export function Reports() {
  return (
    <>
      <header className="page-head">
        <h1>Отчёты</h1>
        <p className="muted">Главные цифры за неделю. Под каждой цифрой аналитик объясняет, почему она изменилась.</p>
      </header>
      <div className="grid">
        {DEMO_KPIS.map((k) => {
          const max = Math.max(...k.series);
          const decimals = Number.isInteger(k.value) ? 0 : 1;
          // For spend, going down is good.
          const good = k.suffix === " $" ? k.delta < 0 : k.delta > 0;
          return (
            <article key={k.label} className="card stack">
              <p className="muted small">{k.label}</p>
              <div className="kpi-value"><CountUp value={k.value} decimals={decimals} />{k.suffix}</div>
              <p className={good ? "delta-up" : "delta-down"}>
                {k.delta > 0 ? "▲" : "▼"} {Math.abs(k.delta)}% за неделю
              </p>
              <div className="bars" aria-hidden>
                {k.series.map((v, i) => (
                  <div key={i} className="bar" style={{ height: `${(v / max) * 100}%`, animationDelay: `${i * 60}ms` }} />
                ))}
              </div>
              <p className="small"><strong>Почему:</strong> {k.why}</p>
            </article>
          );
        })}
      </div>
    </>
  );
}
