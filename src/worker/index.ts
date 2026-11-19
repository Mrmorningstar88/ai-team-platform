import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { leadMail, resendSender, resetMail, verifyMail, type SendMail } from "./email";
import { ceoSystem, claudeCeo, type AskCeo, type ChatTurn } from "./ceo";
import { verifyGithubToken, type Jwks } from "./github-oidc";
import { hashPassword, randomSecret, sha256, verifyPassword } from "./password";
import {
  addLead,
  addMessage,
  addOwnerMessage,
  claimCeoTurn,
  clearLoginFailures,
  countRecentLeads,
  countRecentLoginFailures,
  countRecentResets,
  createAccount,
  createEmailVerification,
  createOrg,
  createReset,
  decideApproval,
  findUserByEmail,
  findUserById,
  getOrCreateSetting,
  getOrgFeed,
  isMember,
  linkOrgFeed,
  listAgents,
  listMessages,
  listOwnerFeeds,
  listPendingApprovals,
  listLinkedOrgs,
  listUnlinkedOwnerFeeds,
  listUserOrgs,
  recordLoginFailure,
  releaseCeoTurn,
  renameOrg,
  saveTeamFeed,
  useEmailVerification,
  useReset,
  getAiBudget,
  addAiSpend,
} from "./repo";
import { parseTeamFeed, projectKey } from "./team";
import { ensureSchema } from "./schema";
import { signSession, verifySession } from "./session";

export interface Env {
  DB: D1Database;
  /** Optional; when unset, a secret is generated once and kept in the database. */
  SESSION_SECRET?: string;
  /** Comma-separated promo codes that allow sign-up; DEFAULT_SIGNUP_CODES when unset. */
  SIGNUP_CODES?: string;
  /** Where landing-page requests are emailed (DEFAULT_LEADS_EMAIL when unset); they are stored either way. */
  LEADS_EMAIL?: string;
  /** Resend API key; needed for password reset emails. */
  RESEND_API_KEY?: string;
  /** Sender, e.g. "AI-команда <noreply@tamania.io>"; the domain must be verified in Resend. */
  MAIL_FROM?: string;
  /** Tests inject a fake sender here. */
  sendMail?: SendMail;
  /** Claude API key for the CEO chat; without it the chat stores messages but the CEO can't answer. */
  ANTHROPIC_API_KEY?: string;
  /** Tests inject a fake CEO here. */
  askCeo?: AskCeo;
  /** Tests inject GitHub's signing keys here. */
  githubJwks?: Jwks;
  /** Comma-separated GitHub account ids whose repositories may report a team (DEFAULT_FEED_OWNER_IDS when unset). */
  FEED_OWNER_IDS?: string;
  /** Comma-separated workflows ("owner/repo/path@ref") that may report a team (DEFAULT_FEED_WORKFLOWS when unset). */
  FEED_WORKFLOWS?: string;
}

type Vars = { userId: string; orgId: string };
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

const MAX_MESSAGE_CHARS = 4000;
const MAX_OWNER_MESSAGES_PER_HOUR = 40;
const CEO_HISTORY = 30;
const SESSION_DAYS = 30;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const MAX_ORGS_PER_USER = 20;
/** A site-wide cap on landing requests, so a bot can't flood the table or the inbox. */
const MAX_LEADS_PER_HOUR = 60;
const RESET_TTL_MS = 60 * 60_000;
const VERIFY_TTL_MS = 3 * 86_400_000;
/** Longer than one CEO call with its retry and fallback model, so a live answer keeps its claim. */
const CEO_TURN_MS = 5 * 60_000;
const MAX_RESETS_PER_HOUR = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The audience a GitHub Actions job requests its token for when it reports to us. */
const GITHUB_AUDIENCE = "tamania";
/**
 * Any GitHub repository in the world can get a valid token for our audience, and the feed names its owner by email.
 * So only repositories of known GitHub accounts may report: Arut's (Mrmorningstar88) by default. A client who
 * connects their own repository later is added to FEED_OWNER_IDS.
 */
const DEFAULT_FEED_OWNER_IDS = "34088726";
/** Within those accounts, only this workflow on main may report, not any other workflow in any of their repos. */
const DEFAULT_FEED_WORKFLOWS = "Mrmorningstar88/arutmain-site/.github/workflows/tamania-sync.yml@refs/heads/main";
/** GitHub owner and repo names are case-insensitive; the file path and ref are not. */
function workflowKey(ref: string): string {
  const [owner = "", repo = "", ...rest] = ref.trim().split("/");
  return [owner.toLowerCase(), repo.toLowerCase(), ...rest].join("/");
}
const MAX_FEED_BYTES = 100_000;
/** Built-in settings, so the owner has nothing to configure; Cloudflare variables override them. */
const DEFAULT_SIGNUP_CODES = "TAMANIA";
const DEFAULT_LEADS_EMAIL = "arutyun@nazaryan.org";

export const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// `ceo` says whether the CEO chat has a model to answer with; the key itself never leaves the server.
app.get("/api/health", (c) => c.json({ ok: true, ceo: Boolean(c.env.askCeo || c.env.ANTHROPIC_API_KEY) }));

// Every other route needs the database; create missing tables on first use.
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") return next();
  if (!c.env.DB) return c.json({ error: "no_database" }, 503);
  await ensureSchema(c.env.DB);
  await next();
});

/** The configured promo code matching `code` (case-insensitive), or null. */
function matchPromo(env: Env, code: string): string | null {
  const wanted = code.trim().toUpperCase();
  if (!wanted) return null;
  const codes = (env.SIGNUP_CODES || DEFAULT_SIGNUP_CODES).split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  return codes.includes(wanted) ? wanted : null;
}

async function sessionSecret(env: Env): Promise<string> {
  return env.SESSION_SECRET || getOrCreateSetting(env.DB, "session_secret", randomSecret);
}

async function currentUser(c: Ctx): Promise<string | null> {
  return verifySession(await sessionSecret(c.env), getCookie(c, "sid"), Date.now());
}

async function startSession(c: Ctx, userId: string) {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  setCookie(c, "sid", await signSession(await sessionSecret(c.env), userId, expires), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

/**
 * Reads a JSON object body. Requiring the JSON content type also blocks
 * cross-site form posts, since browsers preflight that header.
 */
async function jsonBody(c: Ctx): Promise<Record<string, unknown> | null> {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return null;
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Gives the owner a project for each of their teams that reports from GitHub:
 * a project with the same name gets the team, otherwise a new project is made.
 * So an owner who signed up sees all their projects without setting anything up.
 */
async function adoptOwnFeeds(db: D1Database, user: { id: string }) {
  const feeds = await listUnlinkedOwnerFeeds(db, user.id);
  if (feeds.length === 0) return;
  const orgs = await listUserOrgs(db, user.id);
  for (const f of feeds) {
    // "free" for freekonomist counts too, but only when nothing matches exactly.
    const key = projectKey(f.project);
    let org =
      orgs.find((o) => projectKey(o.name) === key) ??
      orgs.find((o) => projectKey(o.name).length >= 3 && key.startsWith(projectKey(o.name)));
    // A project that already shows another team keeps it.
    if (org && (await getOrgFeed(db, org.id))) continue;
    if (!org) {
      if (orgs.length >= MAX_ORGS_PER_USER) return;
      const name = projectTitle(f.project);
      org = { id: await createOrg(db, user.id, { name, goal: "" }), name, goal: "", role: "owner" };
      orgs.push(org);
    }
    await linkOrgFeed(db, org.id, f.id, user.id, Date.now());
  }
}

const projectTitle = (project: string) => project.charAt(0).toUpperCase() + project.slice(1);

/** A project named by the start of its team's name ("free") takes the full name ("Freekonomist"). */
async function completeShortNames(db: D1Database, userId: string) {
  for (const o of await listLinkedOrgs(db, userId)) {
    const short = projectKey(o.name);
    const full = projectKey(o.project);
    if (short !== full && full.startsWith(short)) await renameOrg(db, o.id, userId, projectTitle(o.project));
  }
}

async function me(c: Ctx, userId: string) {
  const user = await findUserById(c.env.DB, userId);
  if (!user) return null;
  await adoptOwnFeeds(c.env.DB, user);
  await completeShortNames(c.env.DB, user.id);
  const { email_verified_ms, ...rest } = user;
  return { user: { ...rest, email_verified: email_verified_ms !== null }, orgs: await listUserOrgs(c.env.DB, userId) };
}

// ---- Sign-up, sign-in, sign-out ----

app.post("/api/auth/signup", async (c) => {
  const body = await jsonBody(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  const email = str(body.email).toLowerCase();
  const name = str(body.name);
  const orgName = str(body.orgName);
  const password = typeof body.password === "string" ? body.password : "";
  if (!EMAIL_RE.test(email) || email.length > 254) return c.json({ error: "invalid_email" }, 400);
  if (password.length < 8 || password.length > 128) return c.json({ error: "weak_password" }, 400);
  if (!name || name.length > 80) return c.json({ error: "invalid_name" }, 400);
  if (!orgName || orgName.length > 80) return c.json({ error: "invalid_org_name" }, 400);
  // Early access: only people with a promo code can create an account.
  const promo = matchPromo(c.env, str(body.promo).slice(0, 64));
  if (!promo) return c.json({ error: "invalid_promo" }, 403);

  const created = await createAccount(c.env.DB, { email, name, orgName, promo, passwordHash: await hashPassword(password) });
  if (!created) return c.json({ error: "email_taken" }, 409);
  // Team feeds name their owner by email, so they only show up once the email is confirmed.
  // A failed email doesn't stop sign-up; a password reset link confirms the email too.
  const send = mailer(c.env);
  if (send) {
    const token = randomSecret();
    await createEmailVerification(c.env.DB, created.userId, await sha256(token), Date.now(), VERIFY_TTL_MS);
    await send(verifyMail(email, name, `${new URL(c.req.url).origin}/#verify=${token}`)).catch(() => false);
  }
  await startSession(c, created.userId);
  return c.json(await me(c, created.userId), 201);
});

app.post("/api/auth/login", async (c) => {
  const body = await jsonBody(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  const email = str(body.email).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || email.length > 254 || password.length > 128) return c.json({ error: "invalid_credentials" }, 401);

  const now = Date.now();
  if ((await countRecentLoginFailures(c.env.DB, email, now - FAILURE_WINDOW_MS)) >= MAX_FAILURES) {
    return c.json({ error: "too_many_attempts" }, 429);
  }
  const user = await findUserByEmail(c.env.DB, email);
  // Same answer for an unknown email and a wrong password, so emails can't be probed.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    await recordLoginFailure(c.env.DB, email, now);
    return c.json({ error: "invalid_credentials" }, 401);
  }
  await clearLoginFailures(c.env.DB, email);
  await startSession(c, user.id);
  return c.json(await me(c, user.id));
});

app.post("/api/auth/logout", (c) => {
  deleteCookie(c, "sid", { path: "/", secure: true });
  return c.json({ ok: true });
});

function mailer(env: Env): SendMail | null {
  if (env.sendMail) return env.sendMail;
  return env.RESEND_API_KEY ? resendSender(env.RESEND_API_KEY, env.MAIL_FROM || "AI-команда <noreply@tamania.io>") : null;
}

// Answers the same way whether or not the email is registered, so emails can't be probed.
app.post("/api/auth/forgot", async (c) => {
  const body = await jsonBody(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  const email = str(body.email).toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return c.json({ error: "invalid_email" }, 400);
  const send = mailer(c.env);
  if (!send) return c.json({ error: "email_not_configured" }, 503);

  const user = await findUserByEmail(c.env.DB, email);
  const now = Date.now();
  if (user && (await countRecentResets(c.env.DB, user.id, now - 60 * 60_000)) < MAX_RESETS_PER_HOUR) {
    const token = randomSecret();
    await createReset(c.env.DB, user.id, await sha256(token), now, RESET_TTL_MS);
    const link = `${new URL(c.req.url).origin}/#reset=${token}`;
    if (!(await send(resetMail(email, user.name, link)))) return c.json({ error: "email_failed" }, 502);
  }
  return c.json({ ok: true });
});

app.post("/api/auth/reset", async (c) => {
  const body = await jsonBody(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  const token = str(body.token);
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8 || password.length > 128) return c.json({ error: "weak_password" }, 400);
  if (!token || token.length > 100) return c.json({ error: "invalid_reset_link" }, 400);
  const userId = await useReset(c.env.DB, await sha256(token), await hashPassword(password), Date.now());
  if (!userId) return c.json({ error: "invalid_reset_link" }, 400);
  await startSession(c, userId);
  return c.json(await me(c, userId));
});

// The link from the sign-up email. It only confirms the email; it does not sign anyone in.
app.post("/api/auth/verify", async (c) => {
  const body = await jsonBody(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  const token = str(body.token);
  if (!token || token.length > 100) return c.json({ error: "invalid_verify_link" }, 400);
  const userId = await useEmailVerification(c.env.DB, await sha256(token), Date.now());
  return userId ? c.json({ ok: true }) : c.json({ error: "invalid_verify_link" }, 400);
});

// Landing page: "no promo code yet" and corporate-plan requests. Public, so input is capped.
app.post("/api/leads", async (c) => {
  const body = await jsonBody(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  const kind = body.kind === "enterprise" ? "enterprise" : body.kind === "access" ? "access" : null;
  const name = str(body.name);
  const email = str(body.email).toLowerCase();
  const company = str(body.company);
  const message = str(body.message);
  if (!kind) return c.json({ error: "invalid_body" }, 400);
  if (!name || name.length > 80) return c.json({ error: "invalid_name" }, 400);
  if (!EMAIL_RE.test(email) || email.length > 254) return c.json({ error: "invalid_email" }, 400);
  if (company.length > 120 || message.length > 2000) return c.json({ error: "too_long" }, 400);
  const now = Date.now();
  if ((await countRecentLeads(c.env.DB, now - 60 * 60_000)) >= MAX_LEADS_PER_HOUR) return c.json({ error: "try_later" }, 429);

  const lead = { kind, name, email, company, message } as const;
  await addLead(c.env.DB, lead, now);
  const send = mailer(c.env);
  // The request is already saved; a failed notification email is not the visitor's problem.
  if (send) await send(leadMail(c.env.LEADS_EMAIL || DEFAULT_LEADS_EMAIL, lead)).catch(() => false);
  return c.json({ ok: true }, 201);
});

app.get("/api/me", async (c) => {
  const userId = await currentUser(c);
  const data = userId ? await me(c, userId) : null;
  return data ? c.json(data) : c.json({ error: "unauthorized" }, 401);
});

// ---- Team feeds ----

// A GitHub Actions job in the owner's repository reports its team's status here.
// It proves where it runs with GitHub's OIDC token, so no shared secret is needed;
// only the default branch may report, so a pull request can't overwrite the office.
app.post("/api/ingest/team", async (c) => {
  const token = /^Bearer (.+)$/.exec(c.req.header("Authorization") ?? "")?.[1];
  const claims = token ? await verifyGithubToken(token, GITHUB_AUDIENCE, Date.now(), c.env.githubJwks) : null;
  if (!claims || claims.ref !== "refs/heads/main") return c.json({ error: "unauthorized" }, 401);
  const owners = (c.env.FEED_OWNER_IDS || DEFAULT_FEED_OWNER_IDS).split(",").map((s) => s.trim()).filter(Boolean);
  if (!owners.includes(claims.ownerId)) return c.json({ error: "forbidden_repository" }, 403);
  const workflows = (c.env.FEED_WORKFLOWS || DEFAULT_FEED_WORKFLOWS).split(",").map((s) => s.trim()).filter(Boolean).map(workflowKey);
  if (!claims.workflowRef || !workflows.includes(workflowKey(claims.workflowRef))) return c.json({ error: "forbidden_workflow" }, 403);
  const raw = await c.req.text();
  if (raw.length > MAX_FEED_BYTES) return c.json({ error: "too_long" }, 413);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // Falls through to the validation error below.
  }
  const feed = parseTeamFeed(body);
  if (!feed) return c.json({ error: "invalid_body" }, 400);
  const id = await saveTeamFeed(c.env.DB, claims.repository, feed, Date.now());
  return c.json({ ok: true, id });
});

// ---- Organization data ----

// A signed-in user adds another project; it starts with the same team as at sign-up.
app.post("/api/orgs", async (c) => {
  const userId = await currentUser(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const body = await jsonBody(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  const name = str(body.name);
  const goal = str(body.goal);
  if (!name || name.length > 80) return c.json({ error: "invalid_org_name" }, 400);
  if (goal.length > 200) return c.json({ error: "invalid_goal" }, 400);
  if ((await listUserOrgs(c.env.DB, userId)).length >= MAX_ORGS_PER_USER) return c.json({ error: "too_many_orgs" }, 409);
  const id = await createOrg(c.env.DB, userId, { name, goal });
  return c.json({ id, name, goal, role: "owner" }, 201);
});

// Signed-in members only. A non-member gets 404, so org ids can't be probed.
app.use("/api/orgs/:orgId/*", async (c, next) => {
  const userId = await currentUser(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const orgId = c.req.param("orgId");
  if (!orgId || !(await isMember(c.env.DB, orgId, userId))) return c.json({ error: "not_found" }, 404);
  c.set("userId", userId);
  c.set("orgId", orgId);
  await next();
});

app.patch("/api/orgs/:orgId", async (c) => {
  const userId = await currentUser(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const org = (await listUserOrgs(c.env.DB, userId)).find((o) => o.id === c.req.param("orgId"));
  if (!org) return c.json({ error: "not_found" }, 404);
  if (org.role !== "owner") return c.json({ error: "forbidden" }, 403);
  const body = await jsonBody(c);
  const name = str(body?.name);
  if (!name || name.length > 80) return c.json({ error: "invalid_org_name" }, 400);
  await renameOrg(c.env.DB, org.id, userId, name);
  return c.json({ ...org, name });
});

app.get("/api/orgs/:orgId/agents", async (c) => c.json(await listAgents(c.env.DB, c.get("orgId"))));

/** The org's team feed; a feed of the owner's whose project matches the org's name is attached on first use. */
async function orgFeed(db: D1Database, orgId: string, userId: string) {
  const feed = await getOrgFeed(db, orgId);
  if (feed) return feed;
  const org = (await listUserOrgs(db, userId)).find((o) => o.id === orgId);
  const match = org && (await listOwnerFeeds(db, userId)).find((f) => projectKey(f.project) === projectKey(org.name));
  return match && (await linkOrgFeed(db, orgId, match.id, userId, Date.now())) ? getOrgFeed(db, orgId) : null;
}

// The org's live team. A feed whose project matches the org's name is attached on
// first look, so the owner has nothing to set up; others are offered to attach.
app.get("/api/orgs/:orgId/team", async (c) => {
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  const feed = await orgFeed(c.env.DB, orgId, userId);
  if (!feed) {
    const own = await listOwnerFeeds(c.env.DB, userId);
    return c.json({ feed: null, available: own.map(({ id, repo, project }) => ({ id, repo, project })) });
  }
  // Feeds saved before goals, tasks and progress existed have none of them.
  const { goal = "", agents, reports, tasks = [], progress = [] } = JSON.parse(feed.payload) as {
    goal?: string; agents: unknown[]; reports: unknown[]; tasks?: unknown[]; progress?: unknown[];
  };
  return c.json({ feed: { repo: feed.repo, project: feed.project, updated_ms: feed.updated_ms, goal, agents, reports, tasks, progress }, available: [] });
});

app.post("/api/orgs/:orgId/team", async (c) => {
  const body = await jsonBody(c);
  const feedId = str(body?.feed_id);
  if (!feedId || feedId.length > 200) return c.json({ error: "invalid_body" }, 400);
  const ok = await linkOrgFeed(c.env.DB, c.get("orgId"), feedId, c.get("userId"), Date.now());
  return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

app.get("/api/orgs/:orgId/approvals", async (c) => c.json(await listPendingApprovals(c.env.DB, c.get("orgId"))));

app.post("/api/orgs/:orgId/approvals/:approvalId/decision", async (c) => {
  const body = await jsonBody(c);
  const decision = body?.decision;
  if (decision !== "approved" && decision !== "rejected") return c.json({ error: "invalid_decision" }, 400);
  const ok = await decideApproval(
    c.env.DB,
    c.get("orgId"),
    c.req.param("approvalId"),
    c.get("userId"),
    decision,
    new Date().toISOString(),
  );
  return ok ? c.json({ ok: true }) : c.json({ error: "not_found_or_decided" }, 409);
});

app.get("/api/orgs/:orgId/messages", async (c) => c.json(await listMessages(c.env.DB, c.get("orgId"))));

/** The model needs turns that alternate and start with the owner; failed replies can leave two owner turns in a row. */
function chatTurns(rows: { author: "owner" | "ceo"; body: string }[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const r of rows) {
    const last = turns[turns.length - 1];
    if (!last && r.author === "ceo") continue;
    if (last?.author === r.author) last.body += `\n\n${r.body}`;
    else turns.push({ author: r.author, body: r.body });
  }
  return turns;
}

// The owner writes to the CEO; the CEO answers from the team's live data. Both are kept as the chat history.
app.post("/api/orgs/:orgId/messages", async (c) => {
  const body = await jsonBody(c);
  const text = body?.body;
  if (typeof text !== "string" || !text.trim() || text.length > MAX_MESSAGE_CHARS) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const orgId = c.get("orgId");
  const id = await addOwnerMessage(c.env.DB, orgId, c.get("userId"), text.trim(), MAX_OWNER_MESSAGES_PER_HOUR);
  if (!id) return c.json({ error: "try_later" }, 429);

  return c.json({ id, ...(await answerOwner(c.env, c.get("userId"), orgId)) }, 201);
});

// Answers the owner's messages that were saved while the CEO couldn't reply (no key yet, or a failed call).
app.post("/api/orgs/:orgId/messages/answer", async (c) => {
  const orgId = c.get("orgId");
  const last = (await listMessages(c.env.DB, orgId, 1)).at(-1);
  if (last?.author !== "owner") return c.json({ reply: null });
  return c.json(await answerOwner(c.env, c.get("userId"), orgId));
});

/** The CEO's reply to the chat so far, saved to the history; null with the reason when there is none. */
async function answerOwner(env: Env, userId: string, orgId: string): Promise<{ reply: { id: string; author: "ceo"; body: string } | null; error?: string }> {
  const ask = env.askCeo ?? (env.ANTHROPIC_API_KEY ? claudeCeo(env.ANTHROPIC_API_KEY) : null);
  if (!ask) return { reply: null, error: "ceo_not_configured" };
  const db = env.DB;
  // One model call per owner turn: parallel requests that lose the claim get no answer of their own.
  const now = Date.now();
  const until = now + CEO_TURN_MS;
  if (!(await claimCeoTurn(db, orgId, now, until))) return { reply: null, error: "ceo_busy" };
  try {
    const org = (await listUserOrgs(db, userId)).find((o) => o.id === orgId);
    const feed = await orgFeed(db, orgId, userId);
    const team = feed ? (JSON.parse(feed.payload) as { goal?: string }) : null;
    const system = ceoSystem({ project: org?.name ?? "", goal: org?.goal || team?.goal || "", team });
    // Like a business with a budget: once this month's AI money is spent, the CEO stops instead of running up a bill.
    const month = new Date(now).toISOString().slice(0, 7);
    const budget = await getAiBudget(db, orgId, month);
    if (budget.spentMicros >= budget.budgetMicros) return { reply: null, error: "ai_budget_exhausted" };
    const answer = await ask(system, chatTurns(await listMessages(db, orgId, CEO_HISTORY))).catch((e: unknown) => {
      console.error("ceo", e);
      return null;
    });
    if (!answer) return { reply: null, error: "ceo_failed" };
    const { text, costMicros } = typeof answer === "string" ? { text: answer, costMicros: 0 } : answer;
    await addAiSpend(db, orgId, month, costMicros);
    const replyId = await addMessage(db, orgId, "ceo", text);
    return { reply: { id: replyId, author: "ceo", body: text } };
  } finally {
    await releaseCeoTurn(db, orgId, until);
  }
}

export default app;
