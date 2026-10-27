import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { leadMail, resendSender, resetMail, type SendMail } from "./email";
import { verifyGithubToken, type Jwks } from "./github-oidc";
import { hashPassword, randomSecret, sha256, verifyPassword } from "./password";
import {
  addLead,
  addOwnerMessage,
  clearLoginFailures,
  countRecentLeads,
  countRecentLoginFailures,
  countRecentResets,
  createAccount,
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
  listUserOrgs,
  recordLoginFailure,
  saveTeamFeed,
  useReset,
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
  /** Tests inject GitHub's signing keys here. */
  githubJwks?: Jwks;
}

type Vars = { userId: string; orgId: string };
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

const MAX_MESSAGE_CHARS = 4000;
const SESSION_DAYS = 30;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const MAX_ORGS_PER_USER = 20;
/** A site-wide cap on landing requests, so a bot can't flood the table or the inbox. */
const MAX_LEADS_PER_HOUR = 60;
const RESET_TTL_MS = 60 * 60_000;
const MAX_RESETS_PER_HOUR = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The audience a GitHub Actions job requests its token for when it reports to us. */
const GITHUB_AUDIENCE = "tamania";
const MAX_FEED_BYTES = 100_000;
/** Built-in settings, so the owner has nothing to configure; Cloudflare variables override them. */
const DEFAULT_SIGNUP_CODES = "TAMANIA";
const DEFAULT_LEADS_EMAIL = "arutyun@nazaryan.org";

export const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.get("/api/health", (c) => c.json({ ok: true }));

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

async function me(c: Ctx, userId: string) {
  const user = await findUserById(c.env.DB, userId);
  if (!user) return null;
  return { user, orgs: await listUserOrgs(c.env.DB, userId) };
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

app.get("/api/orgs/:orgId/agents", async (c) => c.json(await listAgents(c.env.DB, c.get("orgId"))));

// The org's live team. A feed whose project matches the org's name is attached on
// first look, so the owner has nothing to set up; others are offered to attach.
app.get("/api/orgs/:orgId/team", async (c) => {
  const orgId = c.get("orgId");
  const user = await findUserById(c.env.DB, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  let feed = await getOrgFeed(c.env.DB, orgId);
  const own = feed ? [] : await listOwnerFeeds(c.env.DB, user.email);
  if (!feed) {
    const org = (await listUserOrgs(c.env.DB, user.id)).find((o) => o.id === orgId);
    const match = org && own.find((f) => projectKey(f.project) === projectKey(org.name));
    if (match && (await linkOrgFeed(c.env.DB, orgId, match.id, user.email, Date.now()))) feed = await getOrgFeed(c.env.DB, orgId);
  }
  if (!feed) return c.json({ feed: null, available: own.map(({ id, repo, project }) => ({ id, repo, project })) });
  const { agents, reports } = JSON.parse(feed.payload) as { agents: unknown[]; reports: unknown[] };
  return c.json({ feed: { repo: feed.repo, project: feed.project, updated_ms: feed.updated_ms, agents, reports }, available: [] });
});

app.post("/api/orgs/:orgId/team", async (c) => {
  const body = await jsonBody(c);
  const feedId = str(body?.feed_id);
  if (!feedId || feedId.length > 200) return c.json({ error: "invalid_body" }, 400);
  const user = await findUserById(c.env.DB, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const ok = await linkOrgFeed(c.env.DB, c.get("orgId"), feedId, user.email, Date.now());
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

app.post("/api/orgs/:orgId/messages", async (c) => {
  const body = await jsonBody(c);
  const text = body?.body;
  if (typeof text !== "string" || !text.trim() || text.length > MAX_MESSAGE_CHARS) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const id = await addOwnerMessage(c.env.DB, c.get("orgId"), text.trim());
  return c.json({ id }, 201);
});

export default app;
