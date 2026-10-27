import { useEffect, useState } from "react";
import { roleById } from "../../shared/roles";
import { getAgents, type Agent, type Org } from "../api";
import { OfficeScene } from "../components/OfficeScene";
import { ProcessFlow } from "../components/ProcessFlow";
import { Sheet } from "../components/Sheet";

const STATUS_TEXT: Record<string, string> = { working: "Работает", waiting: "Ждёт", idle: "Свободен", paused: "На паузе" };
const FIRST_TASK = "Ждёт первую задачу от CEO";

/** What the detail sheet shows: a real team member, or one from the example scene. */
interface Picked { name: string; role: string; task: string; step: number }

export function Office({ org }: { org: Org }) {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Picked | null>(null);
  const role = open ? roleById(open.role) : undefined;

  useEffect(() => {
    let live = true;
    void getAgents(org.id).then((r) => {
      if (!live) return;
      if (r.ok) setAgents(r.data);
      else setFailed(true);
    });
    return () => { live = false; };
  }, [org.id]);

  const busy = agents?.filter((a) => a.status === "working").length ?? 0;

  return (
    <>
      <header className="page-head">
        <h1>{org.name}</h1>
        <p className="muted">
          {org.goal ? `Цель: ${org.goal}.` : "Цель пока не задана."}
          {agents && ` В команде ${agents.length}, сейчас работают ${busy}.`}
        </p>
      </header>

      <h2 style={{ marginBottom: 12 }}>Команда проекта</h2>
      {failed && <p className="auth-error" role="alert">Не удалось загрузить команду. Обновите страницу.</p>}
      {!agents && !failed && <span className="typing" aria-label="Загрузка"><i /><i /><i /></span>}
      <div className="grid" style={{ marginBottom: 32 }}>
        {agents?.map((a) => {
          const r = roleById(a.role);
          const status = STATUS_TEXT[a.status] ? a.status : "idle";
          return (
            <button
              key={a.id}
              type="button"
              className="card desk"
              onClick={() => setOpen({ name: a.name, role: a.role, task: FIRST_TASK, step: 0 })}
            >
              <div className="row">
                <div className={`avatar ${status}`} aria-hidden>{r?.icon ?? "🤖"}</div>
                <div>
                  <h3>{a.name}</h3>
                  <span className="pill"><span className={`dot dot-${status}`} />{STATUS_TEXT[status]}</span>
                </div>
              </div>
              <p className="small">{FIRST_TASK}</p>
              <p className="muted small">Самостоятельность: {a.autonomy}</p>
            </button>
          );
        })}
      </div>

      <h2 style={{ marginBottom: 6 }}>Как работает команда</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Пример: как задача проходит через команду от CEO до сайта. Нажмите на сотрудника, чтобы увидеть его работу по шагам.
      </p>
      <OfficeScene onPick={(a) => setOpen(a)} />

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
