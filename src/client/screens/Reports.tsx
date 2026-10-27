import { useEffect, useState } from "react";
import type { ProcessStep } from "../../shared/roles";
import { getTeam, type Org, type TeamReport } from "../api";
import { ProcessFlow } from "../components/ProcessFlow";

const REPORT_STEPS: ProcessStep[] = [
  { icon: "📊", title: "Аналитик считает", explain: "Аналитик и QA вашей команды собирают цифры и проверки в GitHub." },
  { icon: "📝", title: "Отчёт в GitHub", explain: "Каждый отчёт — открытая задача с меткой report или qa в вашем репозитории." },
  { icon: "📮", title: "Связной приносит", explain: "Раз в час связной забирает открытые отчёты и отправляет сюда." },
  { icon: "👀", title: "Вы читаете", explain: "Здесь видно каждый отчёт целиком, со ссылкой на оригинал." },
];

const dateText = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
};

export function Reports({ org }: { org: Org }) {
  const [reports, setReports] = useState<TeamReport[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void getTeam(org.id).then((r) => {
      if (!live) return;
      if (r.ok) setReports(r.data.feed?.reports ?? []);
      else setFailed(true);
    });
    return () => { live = false; };
  }, [org.id]);

  return (
    <>
      <header className="page-head">
        <h1>Отчёты</h1>
        <p className="muted">Отчёты вашей команды. Здесь только настоящие данные из вашего репозитория.</p>
      </header>

      {failed && <p className="auth-error" role="alert">Не удалось загрузить отчёты. Обновите страницу.</p>}
      {!failed && reports === null && <span className="typing" aria-label="Загрузка"><i /><i /><i /></span>}
      {reports?.length === 0 && <p className="muted" style={{ marginBottom: 24 }}>Отчётов пока нет. Они появятся, как только команда их напишет.</p>}

      {reports && reports.length > 0 && (
        <div className="stack" style={{ marginBottom: 32 }}>
          {reports.map((r) => (
            <article key={r.link || r.title} className="card stack">
              {r.updated && <p className="muted small">{dateText(r.updated)}</p>}
              <h3>{r.title}</h3>
              <p className="small" style={{ whiteSpace: "pre-line" }}>{r.summary}</p>
              {r.link && <a className="btn btn-plain" href={r.link} target="_blank" rel="noreferrer">Открыть отчёт</a>}
            </article>
          ))}
        </div>
      )}

      <section className="card" aria-labelledby="reports-how">
        <h2 id="reports-how">Откуда берутся отчёты</h2>
        <ProcessFlow steps={REPORT_STEPS} label="Как отчёт попадает сюда" />
      </section>
    </>
  );
}
