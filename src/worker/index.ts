import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { verifySession } from "./session";
import { addOwnerMessage, decideApproval, isMember, listAgents, listMessages, listPendingApprovals } from "./repo";

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
}

type Vars = { userId: string; orgId: string };

const MAX_MESSAGE_CHARS = 4000;

export const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// Signed-in members only. A non-member gets 404, so org ids can't be probed.
app.use("/api/orgs/:orgId/*", async (c, next) => {
  const userId = await verifySession(c.env.SESSION_SECRET, getCookie(c, "sid"), Date.now());
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
  const body: unknown = await c.req.json().catch(() => null);
  const decision = typeof body === "object" && body !== null ? (body as Record<string, unknown>).decision : undefined;
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
  const body: unknown = await c.req.json().catch(() => null);
  const text = typeof body === "object" && body !== null ? (body as Record<string, unknown>).body : undefined;
  if (typeof text !== "string" || !text.trim() || text.length > MAX_MESSAGE_CHARS) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const id = await addOwnerMessage(c.env.DB, c.get("orgId"), text.trim());
  return c.json({ id }, 201);
});

export default app;
