import { useRef, useState } from "react";
import { Confetti } from "../components/Confetti";
import { ProcessFlow } from "../components/ProcessFlow";
import { useReducedMotion } from "../components/useReducedMotion";
import { APPROVAL_PIPELINE, type DemoApproval } from "../demo";

const LEAVE_MS = 240;
const FLY_MS = 750;

interface Flight {
  key: number;
  label: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  started: boolean;
}

export function Approvals({ onCountChange }: { onCountChange: (n: number) => void }) {
  const reduced = useReducedMotion();
  const [items, setItems] = useState<DemoApproval[]>([]);
  const [leaving, setLeaving] = useState<{ id: string; approved: boolean } | null>(null);
  const [lastDone, setLastDone] = useState<{ text: string; approved: boolean; key: number } | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [siteHit, setSiteHit] = useState(0);
  const siteRef = useRef<HTMLSpanElement>(null);

  function finish(id: string, approved: boolean) {
    const next = items.filter((i) => i.id !== id);
    setItems(next);
    setLeaving(null);
    setLastDone({
      text: approved
        ? "Одобрено. Правка уже на сайте, CEO проследит за результатом."
        : "Отклонено. CEO вернёт правку сотруднику с вашим решением.",
      approved,
      key: Date.now(),
    });
    onCountChange(next.length);
  }

  function decide(id: string, approved: boolean, title: string, button: HTMLElement) {
    if (leaving || flight) return; // one decision at a time; no double submits
    setLeaving({ id, approved });
    const site = siteRef.current;
    if (!approved || reduced || !site) {
      window.setTimeout(() => finish(id, approved), LEAVE_MS);
      return;
    }
    // The approved change visibly flies from the button to the site badge.
    const a = button.getBoundingClientRect();
    const b = site.getBoundingClientRect();
    const f: Flight = {
      key: Date.now(),
      label: title,
      from: { x: a.left + a.width / 2, y: a.top + a.height / 2 },
      to: { x: b.left + b.width / 2, y: b.top + b.height / 2 },
      started: false,
    };
    setFlight(f);
    requestAnimationFrame(() => requestAnimationFrame(() => setFlight({ ...f, started: true })));
    window.setTimeout(() => {
      setFlight(null);
      setSiteHit(Date.now());
      finish(id, true);
    }, FLY_MS);
  }

  return (
    <>
      <header className="page-head">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h1>Одобрения</h1>
          <span ref={siteRef} className={`site-badge ${siteHit ? "hit" : ""}`} key={siteHit}>
            🌐 Сайт
            {siteHit > 0 && !reduced && <Confetti />}
          </span>
        </div>
        <p className="muted">Всё, что требует вашего «да», уже проверено техлидом. Одна страница в день.</p>
      </header>

      <section className="card stack" style={{ marginBottom: 24 }}>
        <h2>Как правка попадает на сайт</h2>
        <ProcessFlow steps={APPROVAL_PIPELINE} startAt={2} label="Путь правки до сайта" />
      </section>

      {lastDone && (
        <div className="card stack done-card" role="status" key={lastDone.key}>
          <div className={`check-burst ${lastDone.approved ? "" : "back"}`} aria-hidden>
            {lastDone.approved ? "✓" : "↩"}
          </div>
          <p>{lastDone.text}</p>
        </div>
      )}

      <div className="stack">
        {items.length === 0 && <p className="muted">Сейчас нечего одобрять. Когда команда подготовит правку, она появится здесь.</p>}
        {items.map((a) => (
          <article
            key={a.id}
            className={`card stack approval ${leaving?.id === a.id ? (leaving.approved ? "leaving" : "leaving back") : ""}`}
          >
            <span className="pill">{a.from}</span>
            <h3>{a.title}</h3>
            <p className="muted small">{a.why}</p>
            <div className="diff">
              <div className="diff-before"><span className="muted">Было</span><br />{a.before}</div>
              <div className="diff-after"><span className="muted">Станет</span><br />{a.after}</div>
            </div>
            <div className="row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={leaving !== null}
                onClick={(e) => decide(a.id, true, a.title, e.currentTarget)}
              >
                Одобрить
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={leaving !== null}
                onClick={(e) => decide(a.id, false, a.title, e.currentTarget)}
              >
                Отклонить
              </button>
            </div>
          </article>
        ))}
      </div>

      {flight && (
        <div
          className="flight"
          key={flight.key}
          aria-hidden
          style={{
            left: flight.from.x,
            top: flight.from.y,
            transform: flight.started
              ? `translate(${flight.to.x - flight.from.x}px, ${flight.to.y - flight.from.y}px) scale(0.4) rotate(-8deg)`
              : "translate(0, 0) scale(1)",
          }}
        >
          ✉️ {flight.label}
        </div>
      )}
    </>
  );
}
