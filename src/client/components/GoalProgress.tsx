import { useEffect, useState } from "react";
import type { ProgressItem } from "../api";

const whole = new Intl.NumberFormat("ru-RU");
const short = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });

const money = (n: number, unit: string, fmt: Intl.NumberFormat) => (unit === "$" ? `$${fmt.format(n)}` : fmt.format(n));

/** Share of the way, readable even when tiny: 0,0012% rather than 0%. */
export function percent(value: number, target: number): string {
  const p = (value / target) * 100;
  if (p === 0) return "0%";
  if (p >= 100) return "100%";
  if (p < 0.0001) return "меньше 0,0001%";
  const digits = p >= 10 ? 0 : p >= 1 ? 1 : Math.min(4, 1 - Math.floor(Math.log10(p)));
  return `${p.toLocaleString("ru-RU", { maximumFractionDigits: digits })}%`;
}

/**
 * How far the team is towards the goal, from the project's own counts.
 * Bars fill from empty when shown; a started bar always shows a visible sliver,
 * so 0,1% reads as "begun" and not as nothing.
 */
export function GoalProgress({ items }: { items: ProgressItem[] }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);

  return (
    <section className="card goal-progress section-gap" aria-labelledby="goal-progress">
      <h2 id="goal-progress">Прогресс к цели</h2>
      <ul>
        {items.map((it) => {
          const measured = it.value !== null;
          const hasTarget = it.target !== null;
          const share = measured && hasTarget ? Math.min(1, it.value! / it.target!) : 0;
          return (
            <li key={it.label}>
              <div className="gp-head">
                <span className="gp-label">{it.label}</span>
                {measured && hasTarget && <strong className="gp-pct">{percent(it.value!, it.target!)}</strong>}
              </div>
              <p className="gp-value">
                {!measured
                  ? "Пока не считается"
                  : hasTarget
                    ? <><strong>{money(it.value!, it.unit, whole)}</strong> из {money(it.target!, it.unit, short)}</>
                    : <strong>{money(it.value!, it.unit, whole)}</strong>}
              </p>
              {hasTarget && (
                <div
                  className="gp-bar"
                  role="progressbar"
                  aria-label={it.label}
                  aria-valuemin={0}
                  aria-valuemax={it.target!}
                  aria-valuenow={measured ? it.value! : undefined}
                  aria-valuetext={measured ? `${money(it.value!, it.unit, whole)} из ${money(it.target!, it.unit, whole)}` : "пока не считается"}
                >
                  <span className={`gp-fill ${share > 0 ? "started" : ""}`} style={{ width: shown ? `${share * 100}%` : 0 }} />
                </div>
              )}
              {it.note && <p className="muted small">{it.note}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
