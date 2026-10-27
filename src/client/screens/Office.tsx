import { useEffect, useState } from "react";
import { roleById, type ProcessStep } from "../../shared/roles";
import { getAgents, getTeam, linkTeam, errorText, type Agent, type Org, type TeamMember, type TeamView } from "../api";
import { OfficeScene } from "../components/OfficeScene";
import { ProcessFlow } from "../components/ProcessFlow";
import { Sheet } from "../components/Sheet";

const STATUS_TEXT: Record<string, string> = { working: "Работает", waiting: "Ждёт", idle: "Свободен", paused: "На паузе" };
const FIRST_TASK = "Ждёт первую задачу от CEO";

const TEAM_STATUS: Record<TeamMember["status"], { text: string; dot: string }> = {
  working: { text: "Работает", dot: "working" },
  done: { text: "Готово", dot: "working" },
  error: { text: "Ошибка", dot: "error" },
  waiting: { text: "Ждёт", dot: "waiting" },
  idle: { text: "Свободен", dot: "idle" },
  planned: { text: "Нанимается", dot: "idle" },
};

/** An icon for a team member, from its id: "bx-mail" and "email" are both mail. */
const ICONS: [RegExp, string][] = [
  [/ceo/, "🧭"], [/tech/, "🛠️"], [/qa|test/, "🧪"], [/seo/, "📈"], [/smm|social/, "📣"], [/news/, "📰"],
  [/market|data/, "📡"], [/dev|task/, "💻"], [/mail/, "✉️"], [/push/, "🔔"], [/analyst|report/, "📊"],
  [/ads/, "🎯"], [/promo/, "🎟️"], [/site|build|deploy/, "🚀"],
];
const iconFor = (id: string) => ICONS.find(([re]) => re.test(id))?.[1] ?? "🤖";

const FEED_STEPS: ProcessStep[] = [
  { icon: "🤖", title: "Боты работают", explain: "Ваши сотрудники работают в GitHub: публикуют посты, проверяют PR, обходят сайт, пишут отчёты." },
  { icon: "📮", title: "Связной собирает", explain: "Раз в час бот-связной собирает, кто что сделал, и отправляет сюда." },
  { icon: "🔏", title: "Проверка подписи", explain: "Tamania принимает данные, только если GitHub подтвердил, что они пришли из вашего репозитория. Паролей и ключей нет." },
  { icon: "🏢", title: "Офис обновлён", explain: "Вы видите каждого сотрудника, его последнюю работу и отчёты." },
];

function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return "ещё не работал";
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  if (min < 24 * 60) return `${Math.round(min / 60)} ч назад`;
  return new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/** What the detail sheet shows: a real team member, or one from the example scene. */
interface Picked { name: string; role: string; task: string; step: number }

export function Office({ org }: { org: Org }) {
  const [team, setTeam] = useState<TeamView | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Picked | null>(null);
  const [member, setMember] = useState<TeamMember | null>(null);
  const [linkError, setLinkError] = useState("");
  const role = open ? roleById(open.role) : undefined;

  useEffect(() => {
    let live = true;
    setTeam(null);
    void Promise.all([getTeam(org.id), getAgents(org.id)]).then(([t, a]) => {
      if (!live) return;
      if (t.ok) setTeam(t.data);
      if (a.ok) setAgents(a.data);
      if (!t.ok && !a.ok) setFailed(true);
    });
    return () => { live = false; };
  }, [org.id]);

  async function attach(feedId: string) {
    setLinkError("");
    const r = await linkTeam(org.id, feedId);
    if (!r.ok) return setLinkError(errorText(r.error));
    const t = await getTeam(org.id);
    if (t.ok) setTeam(t.data);
  }

  const feed = team?.feed;
  const busy = feed
    ? feed.agents.filter((a) => a.status === "working").length
    : agents?.filter((a) => a.status === "working").length ?? 0;
  const loading = !failed && (team === null || agents === null);

  return (
    <>
      <header className="page-head">
        <h1>{org.name}</h1>
        <p className="muted">
          {org.goal ? `Цель: ${org.goal}.` : feed ? "" : "Цель пока не задана."}
          {feed && ` В команде ${feed.agents.length}, сейчас работают ${busy}. Обновлено ${ago(new Date(feed.updated_ms).toISOString())}.`}
          {!feed && agents && ` В команде ${agents.length}, сейчас работают ${busy}.`}
        </p>
      </header>

      {failed && <p className="auth-error" role="alert">Не удалось загрузить команду. Обновите страницу.</p>}
      {loading && <span className="typing" aria-label="Загрузка"><i /><i /><i /></span>}

      {team && !feed && team.available.length > 0 && (
        <section className="card stack" style={{ marginBottom: 24 }} aria-labelledby="feed-offer">
          <h2 id="feed-offer">Найдена ваша команда в GitHub</h2>
          <p className="muted">Подключите её, и в этом офисе будут видны настоящие сотрудники и их работа.</p>
          {team.available.map((f) => (
            <button key={f.id} type="button" className="btn btn-primary" onClick={() => void attach(f.id)}>
              Подключить {f.project} ({f.repo})
            </button>
          ))}
          {linkError && <p className="auth-error" role="alert">{linkError}</p>}
        </section>
      )}

      {feed && (
        <>
          <h2 style={{ marginBottom: 12 }}>Команда проекта</h2>
          <div className="grid" style={{ marginBottom: 32 }}>
            {feed.agents.map((a) => {
              const s = TEAM_STATUS[a.status] ?? TEAM_STATUS.idle;
              return (
                <button key={a.id} type="button" className="card desk" onClick={() => setMember(a)}>
                  <div className="row">
                    <div className={`avatar ${a.status === "working" ? "working" : a.status === "waiting" ? "waiting" : ""}`} aria-hidden>{iconFor(a.id)}</div>
                    <div>
                      <h3>{a.name}</h3>
                      <span className="pill"><span className={`dot dot-${s.dot}`} />{s.text} · {ago(a.last_run)}</span>
                    </div>
                  </div>
                  <p className="small">{a.summary || a.role}</p>
                </button>
              );
            })}
          </div>

          {feed.reports.length > 0 && (
            <>
              <h2 style={{ marginBottom: 12 }}>Отчёты команды</h2>
              <div className="stack" style={{ marginBottom: 32 }}>
                {feed.reports.map((r) => (
                  <article key={r.link || r.title} className="card stack">
                    <h3>{r.title}</h3>
                    <p className="small" style={{ whiteSpace: "pre-line" }}>{r.summary}</p>
                    {r.link && <a className="btn btn-plain" href={r.link} target="_blank" rel="noreferrer">Открыть отчёт</a>}
                  </article>
                ))}
              </div>
            </>
          )}

          <section className="card" style={{ marginBottom: 32 }} aria-labelledby="feed-how">
            <h2 id="feed-how">Как работа команды попадает в офис</h2>
            <ProcessFlow steps={FEED_STEPS} label="Как данные попадают в офис" />
          </section>
        </>
      )}

      {team && !feed && agents && (
        <>
          <h2 style={{ marginBottom: 12 }}>Команда проекта</h2>
          <div className="grid" style={{ marginBottom: 32 }}>
            {agents.map((a) => {
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
        </>
      )}

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

      {member && (
        <Sheet title={member.name} onClose={() => setMember(null)}>
          <p className="muted">{member.role}</p>
          <p><strong>Статус:</strong> {(TEAM_STATUS[member.status] ?? TEAM_STATUS.idle).text}, {ago(member.last_run)}</p>
          {member.summary && <p><strong>Последняя работа:</strong> {member.summary}</p>}
          {member.schedule && <p className="small"><strong>График:</strong> {member.schedule}</p>}
          {member.level && <p className="small"><strong>Самостоятельность:</strong> {member.level}</p>}
          {member.link && <a className="btn btn-secondary" href={member.link} target="_blank" rel="noreferrer">Открыть в GitHub</a>}
        </Sheet>
      )}
    </>
  );
}
