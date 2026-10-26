import { useState } from "react";
import { ProcessFlow } from "../components/ProcessFlow";
import { APPROVAL_PIPELINE, DEMO_APPROVALS } from "../demo";

const LEAVE_MS = 240;

export function Approvals({ onCountChange }: { onCountChange: (n: number) => void }) {
  const [items, setItems] = useState(DEMO_APPROVALS);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<string | null>(null);

  function decide(id: string, approved: boolean) {
    if (leaving) return; // one decision at a time; no double submits
    setLeaving(id);
    window.setTimeout(() => {
      const next = items.filter((i) => i.id !== id);
      setItems(next);
      setLeaving(null);
      setLastDone(approved ? "Одобрено. Правка публикуется, CEO проследит за результатом." : "Отклонено. CEO вернёт правку сотруднику с вашим решением.");
      onCountChange(next.length);
    }, LEAVE_MS);
  }

  return (
    <>
      <header className="page-head">
        <h1>Одобрения</h1>
        <p className="muted">Всё, что требует вашего «да», уже проверено техлидом. Одна страница в день.</p>
      </header>

      <section className="card stack" style={{ marginBottom: 24 }}>
        <h2>Как правка попадает на сайт</h2>
        <ProcessFlow steps={APPROVAL_PIPELINE} startAt={2} label="Путь правки до сайта" />
      </section>

      {lastDone && (
        <div className="card stack" role="status" style={{ marginBottom: 16, textAlign: "center" }}>
          <div className="check-burst" aria-hidden>✓</div>
          <p>{lastDone}</p>
        </div>
      )}

      <div className="stack">
        {items.length === 0 && <p className="muted">На сегодня всё. Следующая ссылка придёт завтра утром.</p>}
        {items.map((a) => (
          <article key={a.id} className={`card stack approval ${leaving === a.id ? "leaving" : ""}`}>
            <span className="pill">{a.from}</span>
            <h3>{a.title}</h3>
            <p className="muted small">{a.why}</p>
            <div className="diff">
              <div><span className="muted">Было</span><br />{a.before}</div>
              <div><span className="muted">Станет</span><br />{a.after}</div>
            </div>
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={leaving !== null} onClick={() => decide(a.id, true)}>Одобрить</button>
              <button type="button" className="btn btn-secondary" disabled={leaving !== null} onClick={() => decide(a.id, false)}>Отклонить</button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
