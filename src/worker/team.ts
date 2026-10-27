// The team status a project's bots report: who is on the team, what each did
// last, and the reports they keep. Everything is checked here, since it comes
// from outside.

export type TeamStatus = "working" | "done" | "error" | "waiting" | "idle" | "planned";

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  status: TeamStatus;
  schedule: string;
  level: string;
  last_run: string;
  summary: string;
  link: string;
}

export interface TeamReport { title: string; summary: string; link: string; updated: string }

/** A backlog item: what the team was asked to do and where it stands. */
export type TaskStatus = "new" | "running" | "done" | "failed";
export interface TeamTask { title: string; status: TaskStatus; link: string; updated: string }

export interface TeamFeedInput {
  project: string;
  owner_email: string;
  /** The project's goal in the owner's words, so the CEO knows what it is working towards. */
  goal: string;
  agents: TeamMember[];
  reports: TeamReport[];
  tasks: TeamTask[];
}

const STATUSES: TeamStatus[] = ["working", "done", "error", "waiting", "idle", "planned"];
const MAX_AGENTS = 40;
const MAX_REPORTS = 20;
const MAX_TASKS = 30;
const TASK_STATUSES: TaskStatus[] = ["new", "running", "done", "failed"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A trimmed string of at most `max` characters, "" when absent; undefined when too long or not a string. */
function text(v: unknown, max: number): string | undefined {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length <= max ? s : undefined;
}

/** Only https links, so a feed can't put javascript: URLs into the office. */
function link(v: unknown): string | undefined {
  const s = text(v, 300);
  if (s === undefined || s === "") return s;
  try {
    return new URL(s).protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
}

function member(v: unknown): TeamMember | null {
  if (!isObj(v)) return null;
  const m = {
    id: text(v.id, 40),
    name: text(v.name, 80),
    role: text(v.role, 200),
    status: STATUSES.includes(v.status as TeamStatus) ? (v.status as TeamStatus) : undefined,
    schedule: text(v.schedule, 80),
    level: text(v.level, 8),
    last_run: text(v.last_run, 40),
    summary: text(v.summary, 500),
    link: link(v.link),
  };
  if (Object.values(m).some((x) => x === undefined) || !m.id || !m.name) return null;
  return m as TeamMember;
}

function report(v: unknown): TeamReport | null {
  if (!isObj(v)) return null;
  const r = { title: text(v.title, 200), summary: text(v.summary, 2000), link: link(v.link), updated: text(v.updated, 40) };
  if (Object.values(r).some((x) => x === undefined) || !r.title) return null;
  return r as TeamReport;
}

function task(v: unknown): TeamTask | null {
  if (!isObj(v)) return null;
  const t = {
    title: text(v.title, 200),
    status: TASK_STATUSES.includes(v.status as TaskStatus) ? (v.status as TaskStatus) : undefined,
    link: link(v.link),
    updated: text(v.updated, 40),
  };
  if (Object.values(t).some((x) => x === undefined) || !t.title) return null;
  return t as TeamTask;
}

/** The validated feed, or null when anything in it is malformed. */
export function parseTeamFeed(body: unknown): TeamFeedInput | null {
  if (!isObj(body)) return null;
  const project = typeof body.project === "string" ? body.project.trim().toLowerCase() : "";
  const owner = typeof body.owner_email === "string" ? body.owner_email.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(project) || !EMAIL_RE.test(owner) || owner.length > 254) return null;
  if (!Array.isArray(body.agents) || body.agents.length > MAX_AGENTS) return null;
  const reportsIn = body.reports ?? [];
  if (!Array.isArray(reportsIn) || reportsIn.length > MAX_REPORTS) return null;
  const tasksIn = body.tasks ?? [];
  if (!Array.isArray(tasksIn) || tasksIn.length > MAX_TASKS) return null;
  const goal = text(body.goal, 300);
  if (goal === undefined) return null;
  const agents = body.agents.map(member);
  const reports = reportsIn.map(report);
  const tasks = tasksIn.map(task);
  if (agents.includes(null) || reports.includes(null) || tasks.includes(null)) return null;
  return { project, owner_email: owner, goal, agents: agents as TeamMember[], reports: reports as TeamReport[], tasks: tasks as TeamTask[] };
}

/** "Freekonomist.com" and "freekonomist" name the same project. */
export function projectKey(name: string): string {
  return name.toLowerCase().replace(/\.(com|io|org|net|ru)$/, "").replace(/[^a-z0-9а-яё]/g, "");
}
