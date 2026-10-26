import { useState } from "react";
import { ROLES, type Role } from "../../shared/roles";
import { ProcessFlow } from "../components/ProcessFlow";
import { Sheet } from "../components/Sheet";

const AUTONOMY_TEXT = {
  L0: "Только отчёты, ничего не меняет сам",
  L1: "Готовит правки, публикует после вашего «да»",
  L2: "Публикует сам после проверок",
  L3: "Может действовать во внешних сервисах",
} as const;

export function Team() {
  const [open, setOpen] = useState<Role | null>(null);
  return (
    <>
      <header className="page-head">
        <h1>Нанять сотрудника</h1>
        <p className="muted">Выберите роль и посмотрите, как этот сотрудник работает, ещё до найма.</p>
      </header>
      <div className="grid">
        {ROLES.map((r) => (
          <article key={r.id} className="card stack">
            <div className="row">
              <div className="avatar" aria-hidden>{r.icon}</div>
              <h3>{r.title}</h3>
            </div>
            <p className="small">{r.pitch}</p>
            <p className="muted small">{AUTONOMY_TEXT[r.defaultAutonomy]}</p>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(r)}>Как работает</button>
          </article>
        ))}
      </div>
      {open && (
        <Sheet title={`${open.title}: как работает`} onClose={() => setOpen(null)}>
          <p className="muted">{open.pitch}</p>
          <ProcessFlow steps={open.steps} label={`Процесс: ${open.title}`} />
          <button type="button" className="btn btn-primary" disabled title="Найм заработает после входа в аккаунт">
            Нанять (скоро)
          </button>
        </Sheet>
      )}
    </>
  );
}
