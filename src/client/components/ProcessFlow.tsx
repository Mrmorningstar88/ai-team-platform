import { useEffect, useState } from "react";
import type { ProcessStep } from "../../shared/roles";
import { useReducedMotion } from "./useReducedMotion";

const STEP_MS = 2400;

interface Props {
  steps: ProcessStep[];
  /** Step the real task is on; the animation starts there. */
  startAt?: number;
  label: string;
}

/**
 * Animated explainer for any process: a token travels along the stops and the
 * current stop's explanation is shown below. With reduced motion the same
 * content is a plain numbered list.
 */
export function ProcessFlow({ steps, startAt = 0, label }: Props) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(Math.min(startAt, steps.length - 1));
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (reduced || !playing) return;
    const id = window.setInterval(() => setActive((i) => (i + 1) % steps.length), STEP_MS);
    return () => window.clearInterval(id);
  }, [reduced, playing, steps.length]);

  if (reduced) {
    return (
      <ol className="flow-static" aria-label={label}>
        {steps.map((s, i) => (
          <li key={s.title}>
            <span aria-hidden>{s.icon}</span>
            <div>
              <strong>{i + 1}. {s.title}</strong>
              <p className="muted small">{s.explain}</p>
            </div>
          </li>
        ))}
      </ol>
    );
  }

  const current = steps[active];
  const pct = steps.length > 1 ? (active / (steps.length - 1)) * 100 : 0;
  // Stops are centred in equal columns, so the line runs between the first and last centre.
  const inset = 50 / steps.length;
  const tokenLeft = `calc(${inset}% + ${(100 - 2 * inset) * (pct / 100)}%)`;

  return (
    <div className="flow" role="group" aria-label={label}>
      <div className={`flow-track ${steps.length > 4 ? "many" : ""}`}>
        <div className="flow-line" style={{ left: `${inset}%`, right: `${inset}%` }} />
        <div className="flow-line-fill" style={{ left: `${inset}%`, width: `${(100 - 2 * inset) * (pct / 100)}%` }} />
        <div className="flow-token" style={{ left: tokenLeft }} aria-hidden />
        {steps.map((s, i) => (
          <button
            key={s.title}
            type="button"
            className={`flow-stop ${i < active ? "done" : ""} ${i === active ? "active" : ""}`}
            onClick={() => { setActive(i); setPlaying(false); }}
            aria-current={i === active ? "step" : undefined}
          >
            <span className="flow-icon" aria-hidden>{s.icon}</span>
            <span className="flow-label">{s.title}</span>
          </button>
        ))}
      </div>
      {current && (
        <div className="flow-explain" key={active} aria-live="polite">
          <strong>Шаг {active + 1} из {steps.length}: {current.title}</strong>
          <p className="muted small">{current.explain}</p>
        </div>
      )}
      <div className="flow-controls">
        <button type="button" className="btn btn-plain" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Пауза" : "Смотреть"}
        </button>
        <button type="button" className="btn btn-plain" onClick={() => { setActive((i) => (i + 1) % steps.length); setPlaying(false); }}>
          Следующий шаг →
        </button>
      </div>
    </div>
  );
}
