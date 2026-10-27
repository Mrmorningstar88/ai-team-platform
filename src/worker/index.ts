import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { hashPassword, randomSecret, verifyPassword } from "./password";
import {
  addOwnerMessage,
  clearLoginFailures,
  countRecentLoginFailures,
  createAccount,
  createOrg,
  decideApproval,
  findUserByEmail,
  findUserById,
  getOrCreateSetting,
  isMember,
  listAgents,
  listMessages,
  listPendingApprovals,
  listUserOrgs,
  recordLoginFailure,
} from "./repo";
import { ensureSchema } from "./schema";
import { signSession, verifySession } from "./session";

export interface Env {
  DB: D1Database;
  /** Optional; when unset, a secret is generated once and kept in the database. */
  SESSION_SECRET?: string;
}

type Vars = { userId: string; orgId: string };
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

const MAX_MESSAGE_CHARS = 4000;
const SESSION_DAYS = 30;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const MAX_ORGS_PER_USER = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// Every other route needs the database; create missing tables on first use.
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") return next();
  if (!c.env.DB) return c.json({ error: "no_database" }, 503);
  await ensureSchema(c.env.DB);
  await next();
});

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

  const created = await createAccount(c.env.DB, { email, name, orgName, passwordHash: await hashPassword(password) });
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

app.get("/api/me", async (c) => {
  const userId = await currentUser(c);
  const data = userId ? await me(c, userId) : null;
  return data ? c.json(data) : c.json({ error: "unauthorized" }, 401);
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
