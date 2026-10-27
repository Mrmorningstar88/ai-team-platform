// Thin client for the accounts API. Every response is checked at runtime,
// since the server (or a proxy in front of it) may answer with anything.

export interface Me {
  user: { id: string; email: string; name: string };
  orgs: Org[];
}

export interface Org { id: string; name: string; goal: string; role: string }

export interface Agent { id: string; role: string; name: string; autonomy: string; status: string }

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function isOrg(v: unknown): v is Org {
  return isObj(v) && typeof v.id === "string" && typeof v.name === "string" && typeof v.goal === "string" && typeof v.role === "string";
}

function isAgent(v: unknown): v is Agent {
  return isObj(v) && ["id", "role", "name", "autonomy", "status"].every((k) => typeof v[k] === "string");
}

function isMe(v: unknown): v is Me {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  const user = m.user as Record<string, unknown> | undefined;
  return (
    typeof user === "object" && user !== null &&
    typeof user.id === "string" && typeof user.email === "string" && typeof user.name === "string" &&
    Array.isArray(m.orgs) && m.orgs.every(isOrg)
  );
}

async function call(method: "GET" | "POST" | "PATCH", path: string, body?: object): Promise<ApiResult<unknown>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
  const data: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data };
  const error = typeof data === "object" && data !== null && typeof (data as { error?: unknown }).error === "string"
    ? (data as { error: string }).error
    : "server";
  return { ok: false, status: res.status, error };
}

async function callMe(method: "GET" | "POST" | "PATCH", path: string, body?: object): Promise<ApiResult<Me>> {
  const r = await call(method, path, body);
  if (!r.ok) return r;
  return isMe(r.data) ? { ok: true, data: r.data } : { ok: false, status: 500, error: "server" };
}

export const getMe = () => callMe("GET", "/api/me");

export const login = (email: string, password: string) => callMe("POST", "/api/auth/login", { email, password });

export const signup = (input: { name: string; email: string; password: string; orgName: string; promo: string }) =>
  callMe("POST", "/api/auth/signup", input);

export const forgotPassword = (email: string) => call("POST", "/api/auth/forgot", { email });

export const resetPassword = (token: string, password: string) => callMe("POST", "/api/auth/reset", { token, password });

export const sendLead = (lead: { kind: "access" | "enterprise"; name: string; email: string; company: string; message: string }) =>
  call("POST", "/api/leads", lead);

export async function createOrg(name: string, goal: string): Promise<ApiResult<Org>> {
  const r = await call("POST", "/api/orgs", { name, goal });
  if (!r.ok) return r;
  return isOrg(r.data) ? { ok: true, data: r.data } : { ok: false, status: 500, error: "server" };
}

export async function renameOrg(orgId: string, name: string): Promise<ApiResult<Org>> {
  const r = await call("PATCH", `/api/orgs/${encodeURIComponent(orgId)}`, { name });
  if (!r.ok) return r;
  return isOrg(r.data) ? { ok: true, data: r.data } : { ok: false, status: 500, error: "server" };
}

export async function getAgents(orgId: string): Promise<ApiResult<Agent[]>> {
  const r = await call("GET", `/api/orgs/${encodeURIComponent(orgId)}/agents`);
  if (!r.ok) return r;
  return Array.isArray(r.data) && r.data.every(isAgent) ? { ok: true, data: r.data } : { ok: false, status: 500, error: "server" };
}

export type TeamStatus = "working" | "done" | "error" | "waiting" | "idle" | "planned";
export interface TeamMember { id: string; name: string; role: string; status: TeamStatus; schedule: string; level: string; last_run: string; summary: string; link: string }
export interface TeamReport { title: string; summary: string; link: string; updated: string }
export type TaskStatus = "new" | "running" | "done" | "failed";
export interface TeamTask { title: string; status: TaskStatus; link: string; updated: string }
export interface ProgressItem { label: string; value: number | null; target: number | null; unit: string; note: string }
export interface TeamFeed {
  repo: string; project: string; updated_ms: number; goal: string;
  agents: TeamMember[]; reports: TeamReport[]; tasks: TeamTask[]; progress: ProgressItem[];
}
export interface TeamView { feed: TeamFeed | null; available: { id: string; repo: string; project: string }[] }

const strs = (v: Record<string, unknown>, keys: string[]) => keys.every((k) => typeof v[k] === "string");
const numOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));

function isTeamView(v: unknown): v is TeamView {
  if (!isObj(v) || !Array.isArray(v.available) || !v.available.every((f) => isObj(f) && strs(f, ["id", "repo", "project"]))) return false;
  if (v.feed === null) return true;
  const f = v.feed;
  return (
    isObj(f) && strs(f, ["repo", "project"]) && typeof f.updated_ms === "number" &&
    Array.isArray(f.agents) && f.agents.every((a) => isObj(a) && strs(a, ["id", "name", "role", "status", "schedule", "level", "last_run", "summary", "link"])) &&
    Array.isArray(f.reports) && f.reports.every((r) => isObj(r) && strs(r, ["title", "summary", "link", "updated"])) &&
    typeof f.goal === "string" &&
    Array.isArray(f.tasks) && f.tasks.every((t) => isObj(t) && strs(t, ["title", "status", "link", "updated"])) &&
    Array.isArray(f.progress) && f.progress.every((p) => isObj(p) && strs(p, ["label", "unit", "note"]) && numOrNull(p.value) && numOrNull(p.target))
  );
}

export async function getTeam(orgId: string): Promise<ApiResult<TeamView>> {
  const r = await call("GET", `/api/orgs/${encodeURIComponent(orgId)}/team`);
  if (!r.ok) return r;
  return isTeamView(r.data) ? { ok: true, data: r.data } : { ok: false, status: 500, error: "server" };
}

export const linkTeam = (orgId: string, feedId: string) => call("POST", `/api/orgs/${encodeURIComponent(orgId)}/team`, { feed_id: feedId });

export const logout = () => call("POST", "/api/auth/logout", {});

/** Russian text for every error code the accounts API can return. */
export const ERROR_TEXT: Record<string, string> = {
  invalid_email: "Проверьте почту: похоже, в адресе ошибка.",
  weak_password: "Пароль нужен от 8 до 128 символов.",
  invalid_name: "Напишите, как вас зовут (до 80 символов).",
  invalid_org_name: "Дайте название (до 80 символов).",
  invalid_goal: "Цель должна быть короче 200 символов.",
  too_many_orgs: "Достигнут предел: 20 проектов на аккаунт.",
  email_taken: "На эту почту уже есть аккаунт. Войдите или используйте другую почту.",
  invalid_credentials: "Почта или пароль не подходят.",
  too_many_attempts: "Слишком много попыток. Подождите 15 минут и попробуйте снова.",
  no_database: "Сервер ещё не подключён к базе данных. Владельцу нужно добавить базу D1 в настройках Cloudflare.",
  invalid_reset_link: "Ссылка устарела или уже использована. Запросите новую.",
  email_not_configured: "Отправка писем ещё не настроена. Напишите администратору.",
  email_failed: "Не получилось отправить письмо. Попробуйте через минуту.",
  invalid_promo: "Такого промокода нет. Проверьте написание или оставьте заявку на доступ.",
  too_long: "Сообщение слишком длинное.",
  try_later: "Сейчас слишком много заявок. Попробуйте через час.",
  network: "Нет связи с сервером. Проверьте интернет и попробуйте снова.",
};

export const errorText = (code: string) => ERROR_TEXT[code] ?? "Что-то пошло не так. Попробуйте ещё раз.";

export interface ChatMessage { id: string; author: "owner" | "ceo"; body: string }
const isChatMessage = (m: unknown): m is ChatMessage =>
  isObj(m) && typeof m.id === "string" && (m.author === "owner" || m.author === "ceo") && typeof m.body === "string";

export async function getMessages(orgId: string): Promise<ApiResult<ChatMessage[]>> {
  const r = await call("GET", `/api/orgs/${encodeURIComponent(orgId)}/messages`);
  if (!r.ok) return r;
  return Array.isArray(r.data) && r.data.every(isChatMessage) ? { ok: true, data: r.data } : { ok: false, status: 500, error: "server" };
}

/** Asks the CEO to answer the owner's messages saved while it couldn't reply; `reply` is null when there was nothing to answer. */
export async function answerSaved(orgId: string): Promise<ApiResult<{ reply: ChatMessage | null; error?: string }>> {
  const r = await call("POST", `/api/orgs/${encodeURIComponent(orgId)}/messages/answer`);
  if (!r.ok) return r;
  const d = r.data;
  if (!isObj(d) || (d.reply !== null && !isChatMessage(d.reply))) return { ok: false, status: 500, error: "server" };
  return { ok: true, data: { reply: d.reply as ChatMessage | null, error: typeof d.error === "string" ? d.error : undefined } };
}

/** Sends the owner's message; `reply` is the CEO's answer, or null with `error` when the CEO could not answer. */
export async function sendMessage(orgId: string, body: string): Promise<ApiResult<{ id: string; reply: ChatMessage | null; error?: string }>> {
  const r = await call("POST", `/api/orgs/${encodeURIComponent(orgId)}/messages`, { body });
  if (!r.ok) return r;
  const d = r.data;
  if (!isObj(d) || typeof d.id !== "string" || (d.reply !== null && !isChatMessage(d.reply))) return { ok: false, status: 500, error: "server" };
  return { ok: true, data: { id: d.id, reply: d.reply as ChatMessage | null, error: typeof d.error === "string" ? d.error : undefined } };
}
