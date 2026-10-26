import { useState } from "react";
import { roleById } from "../../shared/roles";
import { OfficeScene } from "../components/OfficeScene";
import { ProcessFlow } from "../components/ProcessFlow";
import { Sheet } from "../components/Sheet";
import { DEMO_AGENTS, DEMO_ORG, type DemoAgent } from "../demo";

const STATUS_TEXT = { working: "Работает", waiting: "Ждёт", idle: "Свободен" } as const;

export function Office() {
  const [open, setOpen] = useState<DemoAgent | null>(null);
  const role = open ? roleById(open.role) : undefined;
  const busy = DEMO_AGENTS.filter((a) => a.status === "working").length;

  return (
    <>
      <header className="page-head">
        <h1>Офис</h1>
        <p className="muted">
          Цель: {DEMO_ORG.goal}. Сейчас работают {busy} из {DEMO_AGENTS.length}. Ниже видно, как задача проходит через команду. Нажмите на любого сотрудника, чтобы увидеть его работу по шагам.
        </p>
      </header>

      <OfficeScene onPick={setOpen} />

      <h2 style={{ marginBottom: 12 }}>Кто чем занят</h2>

      <div className="grid">
        {DEMO_AGENTS.map((a) => {
          const r = roleById(a.role);
          return (
            <button key={a.id} type="button" className="card desk" onClick={() => setOpen(a)}>
              <div className="row">
                <div className={`avatar ${a.status}`} aria-hidden>{r?.icon}</div>
                <div>
                  <h3>{a.name}</h3>
                  <span className="pill"><span className={`dot dot-${a.status}`} />{STATUS_TEXT[a.status]}</span>
                </div>
              </div>
              <p className="small">
                {a.task} {a.status === "working" && <span className="typing" aria-hidden><i /><i /><i /></span>}
              </p>
              {r && <p className="muted small">Шаг {a.step + 1} из {r.steps.length}: {r.steps[a.step]?.title}</p>}
            </button>
          );
        })}
      </div>

      {open && role && (
        <Sheet title={`${open.name}: как идёт работа`} onClose={() => setOpen(null)}>
          <p className="muted">{role.pitch}</p>
          <p><strong>Сейчас:</strong> {open.task}</p>
          <ProcessFlow steps={role.steps} startAt={open.step} label={`Процесс: ${open.name}`} />
        </Sheet>
      )}
    </>
  );
}
