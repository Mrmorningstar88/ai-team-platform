import { useEffect, useState, type FormEvent } from "react";
import { roleById, type ProcessStep } from "../../shared/roles";
import {
  getAgents, getTeam, linkTeam, renameOrg, errorText,
  type Agent, type Org, type TaskStatus, type TeamFeed, type TeamMember, type TeamView,
} from "../api";
import { OfficeScene, type SceneBeat, type ScenePerson } from "../components/OfficeScene";
import { ProcessFlow } from "../components/ProcessFlow";
import { Sheet } from "../components/Sheet";

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
  [/ads/, "🎯"], [/promo/, "🎟️"], [/site|build|deploy/, "🚀"], [/content/, "✍️"],
];
const iconFor = (id: string) => ICONS.find(([re]) => re.test(id))?.[1] ?? "🤖";

// Shirt colors are system colors (tokens.css), never blue: blue is kept for things you can tap.
const COLORS = ["var(--sys-purple)", "var(--sys-indigo)", "var(--sys-teal)", "var(--sys-orange)", "var(--sys-pink)", "var(--sys-green)", "var(--sys-brown)", "var(--sys-mint)"];
const colorFor = (id: string) => COLORS[[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % COLORS.length]!;

const TASK_COLUMNS: { status: TaskStatus; icon: string; title: string }[] = [
  { status: "new", icon: "📥", title: "Ждут" },
  { status: "running", icon: "⚙️", title: "В работе" },
  { status: "done", icon: "✅", title: "Готово" },
  { status: "failed", icon: "⚠️", title: "Не вышло" },
];

const FEED_STEPS: ProcessStep[] = [
  { icon: "🤖", title: "Боты работают", explain: "Ваши сотрудники работают в GitHub: публикуют посты, проверяют PR, обходят сайт, пишут отчёты." },
  { icon: "📮", title: "Связной собирает", explain: "Раз в час бот-связной собирает, кто что сделал, и отправляет сюда." },
  { icon: "🔏", title: "Проверка подписи", explain: "Tamania принимает данные, только если GitHub подтвердил, что они пришли из вашего репозитория." },
  { icon: "🏢", title: "Офис обновлён", explain: "Вы видите каждого сотрудника, его последнюю работу, задачи и отчёты." },
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

const runTime = (a: TeamMember) => Date.parse(a.last_run) || 0;
const plain = (summary: string) => summary.replace(/^Отработал без ошибок:?\s*/, "").replace(/\.$/, "");

/** Real people at real desks, in the order the team lists them. */
function feedPeople(feed: TeamFeed): ScenePerson[] {
  return feed.agents.map((a) => ({
    id: a.id,
    name: a.name,
    icon: iconFor(a.id),
    color: colorFor(a.id),
    mode: a.status,
    label: a.summary || a.role,
  }));
}

/** The office's story, made only of what the team actually did: latest runs first, then open tasks. */
function feedBeats(feed: TeamFeed): SceneBeat[] {
  const ids = new Set(feed.agents.map((a) => a.id));
  const boss = ids.has("ceo") ? "ceo" : "owner";
  const runs: SceneBeat[] = feed.agents
    .filter((a) => a.last_run && a.id !== boss)
    .sort((a, b) => runTime(b) - runTime(a))
    .slice(0, 8)
    .map((a) => {
      const explain = `${a.name}, ${ago(a.last_run)}: ${a.summary || a.role}`;
      if (a.status === "error") return { from: a.id, to: boss, item: "Ошибка", says: "Нужна помощь", explain };
      if (a.status === "working") return { from: a.id, to: boss, item: "В работе", says: "Работаю прямо сейчас", explain };
      return { from: a.id, to: "site", item: "Готово", says: plain(a.summary) || "Готово", explain };
    });
  const dev = feed.agents.find((a) => /dev/.test(a.id))?.id;
  const tasks: SceneBeat[] = dev
    ? feed.tasks
        .filter((t) => t.status === "new" || t.status === "running")
        .slice(0, 3)
        .map((t) => ({
          from: "owner",
          to: dev,
          item: "Задача",
          says: t.title,
          explain: `Задача «${t.title}» ${t.status === "running" ? "уже в работе у разработчика" : "ждёт разработчика в очереди"}.`,
        }))
    : [];
  return [...tasks, ...runs];
}

/** The starter team before any bots report: everyone sits ready, nobody pretends to work. */
function starterPeople(agents: Agent[]): ScenePerson[] {
  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    icon: roleById(a.role)?.icon ?? "🤖",
    color: colorFor(a.role),
    mode: "idle",
    label: "Ждёт первую задачу",
  }));
}

export function Office({ org, onRenamed }: { org: Org; onRenamed: (org: Org) => void }) {
  const [team, setTeam] = useState<TeamView | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [member, setMember] = useState<TeamMember | null>(null);
  const [starter, setStarter] = useState<Agent | null>(null);
  const [linkError, setLinkError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");

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

  async function rename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRenameError("");
    const r = await renameOrg(org.id, String(new FormData(e.currentTarget).get("name") ?? ""));
    if (!r.ok) return setRenameError(errorText(r.error));
    setRenaming(false);
    onRenamed(r.data);
  }

  const feed = team?.feed;
  const goal = org.goal || feed?.goal || "";
  const loading = !failed && (team === null || agents === null);
  const busy = feed?.agents.filter((a) => a.status === "working").length ?? 0;
  const broken = feed?.agents.filter((a) => a.status === "error").length ?? 0;

  function pick(id: string) {
    if (feed) setMember(feed.agents.find((a) => a.id === id) ?? null);
    else setStarter(agents?.find((a) => a.id === id) ?? null);
  }

  return (
    <>
      <header className="page-head">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h1>{org.name}</h1>
          {org.role === "owner" && (
            <button type="button" className="btn btn-plain" onClick={() => { setRenameError(""); setRenaming(true); }}>Переименовать</button>
          )}
        </div>
        {goal && <p className="muted">Цель: {goal}</p>}
      </header>

      {failed && <p className="auth-error" role="alert">Не удалось загрузить команду. Обновите страницу.</p>}
      {loading && <span className="typing" aria-label="Загрузка"><i /><i /><i /></span>}

      {team && !feed && team.available.length > 0 && (
        <section className="card stack section-gap" aria-labelledby="feed-offer">
          <h2 id="feed-offer">Найдена ваша команда в GitHub</h2>
          <p className="muted">Подключите её, и в этом офисе будут видны настоящие сотрудники и их работа.</p>
          {team.available.map((f) => (
            <button key={f.id} type="button" className="btn btn-primary" onClick={() => void attach(f.id)}>
              Подключить {f.project}
            </button>
          ))}
          {linkError && <p className="auth-error" role="alert">{linkError}</p>}
        </section>
      )}

      {feed && (
        <>
          <div className="office-stats" role="list" aria-label="Команда сейчас">
            <div role="listitem" className="stat"><span aria-hidden>👥</span><strong>{feed.agents.length}</strong> в команде</div>
            <div role="listitem" className="stat"><span aria-hidden>⌨️</span><strong>{busy}</strong> работают</div>
            <div role="listitem" className={`stat ${broken ? "stat-bad" : ""}`}><span aria-hidden>⚠️</span><strong>{broken}</strong> с ошибкой</div>
            <div role="listitem" className="stat"><span aria-hidden>🔄</span>{ago(new Date(feed.updated_ms).toISOString())}</div>
          </div>
          <p className="muted section-note">Это ваш офис. Внизу по шагам показано, что команда сделала последним. Нажмите на сотрудника, чтобы увидеть подробности.</p>
          <OfficeScene people={feedPeople(feed)} beats={feedBeats(feed)} goal={goal} onPick={pick} label={`Офис ${org.name}`} />

          <h2 className="section-title">Бэклог задач</h2>
          {feed.tasks.length === 0 ? (
            <p className="muted section-gap">Задач в очереди нет. Новые задачи появятся здесь, как только вы или CEO их поставите.</p>
          ) : (
            <div className="board section-gap">
              {TASK_COLUMNS.map((col) => {
                const items = feed.tasks.filter((t) => t.status === col.status);
                return (
                  <section key={col.status} className={`board-col col-${col.status}`} aria-label={col.title}>
                    <h3><span aria-hidden>{col.icon}</span> {col.title} <span className="board-count">{items.length}</span></h3>
                    {items.length === 0 && <p className="muted small">Пусто</p>}
                    {items.map((t, i) => (
                      <article key={`${t.title}-${i}`} className="board-card" style={{ animationDelay: `${i * 60}ms` }}>
                        <p>{t.title}</p>
                        <p className="muted small">{ago(t.updated)}</p>
                        {t.link && <a href={t.link} target="_blank" rel="noreferrer" className="small">Открыть PR</a>}
                      </article>
                    ))}
                  </section>
                );
              })}
            </div>
          )}

          <h2 className="section-title">Кто чем занят</h2>
          <div className="grid section-gap">
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

          <section className="card stack section-gap" aria-labelledby="feed-how">
            <h2 id="feed-how">Как работа команды попадает сюда</h2>
            <ProcessFlow steps={FEED_STEPS} label="Как данные попадают в офис" />
          </section>
        </>
      )}

      {team && !feed && agents && (
        <>
          <p className="muted section-note">Команда на местах и ждёт первую задачу. Напишите CEO в чат, что нужно сделать.</p>
          <OfficeScene people={starterPeople(agents)} beats={[]} goal={goal} onPick={pick} label={`Офис ${org.name}`} />
        </>
      )}

      {starter && (
        <Sheet title={starter.name} onClose={() => setStarter(null)}>
          <p className="muted">{roleById(starter.role)?.pitch}</p>
          <p><strong>Сейчас:</strong> ждёт первую задачу от CEO.</p>
          {roleById(starter.role) && <ProcessFlow steps={roleById(starter.role)!.steps} label={`Как работает: ${starter.name}`} />}
        </Sheet>
      )}

      {renaming && (
        <Sheet title="Переименовать проект" onClose={() => setRenaming(false)}>
          <form className="auth-form" onSubmit={rename}>
            <label className="field">
              <span>Название</span>
              <input name="name" required maxLength={80} defaultValue={org.name} />
            </label>
            {renameError && <p className="auth-error" role="alert">{renameError}</p>}
            <button type="submit" className="btn btn-primary">Сохранить название</button>
          </form>
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
