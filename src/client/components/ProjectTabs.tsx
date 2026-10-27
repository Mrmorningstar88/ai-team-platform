import { useState, type FormEvent } from "react";
import type { ProcessStep } from "../../shared/roles";
import { createOrg, errorText, type Org } from "../api";
import { ProcessFlow } from "./ProcessFlow";
import { Sheet } from "./Sheet";

const NEW_PROJECT_STEPS: ProcessStep[] = [
  { icon: "📁", title: "Проект", explain: "Создаём отдельный проект. Его задачи, отчёты и одобрения не смешиваются с другими." },
  { icon: "🧑‍💼", title: "Команда", explain: "В проект приходит своя команда: CEO, техлид, тестировщик, SEO, контент и аналитик." },
  { icon: "🎯", title: "Цель", explain: "CEO получает цель проекта и по ней ставит задачи команде." },
  { icon: "🔀", title: "Вкладка", explain: "Проект появляется вкладкой сверху. Одно касание, и вы в его офисе." },
];

interface Props {
  orgs: Org[];
  current: string;
  onSelect: (id: string) => void;
  onCreated: (org: Org) => void;
}

/** Tabs for switching between the owner's projects, plus adding a new one. */
export function ProjectTabs({ orgs, current, onSelect, onCreated }: Props) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const r = await createOrg(String(f.get("name") ?? ""), String(f.get("goal") ?? ""));
    setBusy(false);
    if (!r.ok) return setError(errorText(r.error));
    setAdding(false);
    onCreated(r.data);
  }

  return (
    <>
      <div className="projects" role="tablist" aria-label="Проекты">
        {orgs.map((o) => (
          <button
            key={o.id}
            type="button"
            role="tab"
            className="project-tab"
            aria-selected={o.id === current}
            onClick={() => onSelect(o.id)}
          >
            {o.name}
          </button>
        ))}
        <button type="button" className="project-tab project-add" onClick={() => { setError(""); setAdding(true); }}>
          + Проект
        </button>
      </div>

      {adding && (
        <Sheet title="Новый проект" onClose={() => setAdding(false)}>
          <form className="auth-form" onSubmit={submit}>
            <label className="field">
              <span>Название</span>
              <input name="name" required maxLength={80} placeholder="Например, Brainax" />
            </label>
            <label className="field">
              <span>Цель проекта</span>
              <input name="goal" maxLength={200} placeholder="Например, больше учеников" />
            </label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Создаём…" : "Создать проект"}
            </button>
          </form>
          <h3>Что произойдёт</h3>
          <ProcessFlow steps={NEW_PROJECT_STEPS} label="Шаги создания проекта" />
        </Sheet>
      )}
    </>
  );
}
