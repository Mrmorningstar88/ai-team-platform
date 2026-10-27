import { beforeEach, describe, expect, it } from "vitest";
import type { Mail } from "../src/worker/email";
import { app, type Env } from "../src/worker/index";
import { signSession, verifySession } from "../src/worker/session";
import { createTestDb } from "./d1";

const SECRET = "test-secret";

let env: Env;

beforeEach(() => {
  const { d1, raw } = createTestDb();
  raw.exec(`
    INSERT INTO users (id, email, name) VALUES ('u-a', 'a@example.com', 'A'), ('u-b', 'b@example.com', 'B');
    INSERT INTO orgs (id, name) VALUES ('org-a', 'A Inc'), ('org-b', 'B Inc');
    INSERT INTO memberships (org_id, user_id) VALUES ('org-a', 'u-a'), ('org-b', 'u-b');
    INSERT INTO agents (id, org_id, role, name) VALUES ('ag-a', 'org-a', 'ceo', 'CEO A'), ('ag-b', 'org-b', 'ceo', 'CEO B');
    INSERT INTO tasks (id, org_id, agent_id, title) VALUES ('t-a', 'org-a', 'ag-a', 'x'), ('t-b', 'org-b', 'ag-b', 'y');
    INSERT INTO approvals (id, org_id, task_id, summary) VALUES ('ap-a', 'org-a', 't-a', 'A change'), ('ap-b', 'org-b', 't-b', 'B change');
  `);
  env = { DB: d1, SESSION_SECRET: SECRET, SIGNUP_CODES: "EARLY, friends" };
});

async function as(userId: string) {
  return { Cookie: `sid=${await signSession(SECRET, userId, Date.now() + 60_000)}` };
}

describe("session", () => {
  it("rejects forged, expired and malformed tokens", async () => {
    const good = await signSession(SECRET, "u-a", 2_000);
    expect(await verifySession(SECRET, good, 1_000)).toBe("u-a");
    expect(await verifySession(SECRET, good, 3_000)).toBeNull();
    expect(await verifySession("other", good, 1_000)).toBeNull();
    expect(await verifySession(SECRET, good.replace("u-a", "u-b"), 1_000)).toBeNull();
    expect(await verifySession(SECRET, "garbage", 1_000)).toBeNull();
  });
});

describe("tenant isolation", () => {
  it("requires a session", async () => {
    const res = await app.request("/api/orgs/org-a/agents", {}, env);
    expect(res.status).toBe(401);
  });

  it("returns only the member's own org data", async () => {
    const res = await app.request("/api/orgs/org-a/agents", { headers: await as("u-a") }, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }[]).map((a) => a.id)).toEqual(["ag-a"]);
  });

  it("hides another org behind 404", async () => {
    const res = await app.request("/api/orgs/org-b/agents", { headers: await as("u-a") }, env);
    expect(res.status).toBe(404);
  });

  it("cannot decide another org's approval through its own org", async () => {
    const res = await app.request(
      "/api/orgs/org-a/approvals/ap-b/decision",
      { method: "POST", headers: { ...(await as("u-a")), "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approved" }) },
      env,
    );
    expect(res.status).toBe(409);
  });
});

describe("approvals", () => {
  it("records a decision once and logs it", async () => {
    const post = async () =>
      app.request(
        "/api/orgs/org-a/approvals/ap-a/decision",
        { method: "POST", headers: { ...(await as("u-a")), "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approved" }) },
        env,
      );
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(409);
    const pending = await app.request("/api/orgs/org-a/approvals", { headers: await as("u-a") }, env);
    expect(await pending.json()).toEqual([]);
  });

  it("rejects an unknown decision", async () => {
    const res = await app.request(
      "/api/orgs/org-a/approvals/ap-a/decision",
      { method: "POST", headers: { ...(await as("u-a")), "Content-Type": "application/json" }, body: JSON.stringify({ decision: "maybe" }) },
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("messages", () => {
  it("stores a trimmed owner message and rejects empty or oversized ones", async () => {
    const headers = { ...(await as("u-a")), "Content-Type": "application/json" };
    const send = (body: string) => app.request("/api/orgs/org-a/messages", { method: "POST", headers, body: JSON.stringify({ body }) }, env);
    expect((await send("  Привет, CEO  ")).status).toBe(201);
    expect((await send("   ")).status).toBe(400);
    expect((await send("x".repeat(4001))).status).toBe(400);
    const list = await app.request("/api/orgs/org-a/messages", { headers }, env);
    expect(((await list.json()) as { body: string }[]).map((m) => m.body)).toEqual(["Привет, CEO"]);
  });
});

describe("accounts", () => {
  const json = { "Content-Type": "application/json" };
  const signup = (body: Record<string, unknown>, e: Env = env) =>
    app.request("/api/auth/signup", { method: "POST", headers: json, body: JSON.stringify(body) }, e);
  const login = (email: string, password: string) =>
    app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email, password }) }, env);
  const cookieOf = (res: Response) => res.headers.get("Set-Cookie")?.split(";")[0] ?? "";
  const owner = { email: "Owner@Example.com", password: "correct horse", name: "Арут", orgName: "freekonomist", promo: "early" };

  it("signs up an owner with an organization and its starter team", async () => {
    const res = await signup(owner);
    expect(res.status).toBe(201);
    expect(res.headers.get("Set-Cookie")).toMatch(/HttpOnly/);
    const body = (await res.json()) as { user: { email: string }; orgs: { id: string; name: string; role: string }[] };
    expect(body.user.email).toBe("owner@example.com");
    expect(body.orgs).toEqual([expect.objectContaining({ name: "freekonomist", role: "owner" })]);

    const agents = await app.request(`/api/orgs/${body.orgs[0]!.id}/agents`, { headers: { Cookie: cookieOf(res) } }, env);
    expect(((await agents.json()) as { role: string }[]).map((a) => a.role)).toEqual(["ceo", "techlead", "qa", "seo", "content", "analyst"]);
  });

  it("validates sign-up input and refuses a taken email", async () => {
    expect((await signup({ ...owner, email: "not-an-email" })).status).toBe(400);
    expect((await signup({ ...owner, password: "short" })).status).toBe(400);
    expect((await signup({ ...owner, orgName: "  " })).status).toBe(400);
    // Early access: no code or a wrong code is refused; with no codes configured, the built-in one works.
    expect((await signup({ ...owner, promo: undefined })).status).toBe(403);
    expect((await signup({ ...owner, promo: "guess" })).status).toBe(403);
    expect((await signup(owner, { ...env, SIGNUP_CODES: undefined })).status).toBe(403);
    expect((await signup({ ...owner, email: "builtin@example.com", promo: "tamania" }, { ...env, SIGNUP_CODES: undefined })).status).toBe(201);
    expect((await signup({ ...owner, email: "friend@example.com", promo: " Friends " })).status).toBe(201);
    expect((await app.request("/api/auth/signup", { method: "POST", body: JSON.stringify(owner) }, env)).status).toBe(400);
    expect((await signup(owner)).status).toBe(201);
    expect((await signup({ ...owner, email: "OWNER@example.com" })).status).toBe(409);
  });

  it("adds a project for its owner only, with its own starter team", async () => {
    const res = await signup(owner);
    const cookie = { Cookie: cookieOf(res), ...json };
    const add = (body: Record<string, unknown>, headers: Record<string, string> = cookie) =>
      app.request("/api/orgs", { method: "POST", headers, body: JSON.stringify(body) }, env);

    expect((await add({ name: "Brainax" }, json)).status).toBe(401);
    expect((await add({ name: " " })).status).toBe(400);
    const created = await add({ name: "Brainax", goal: "Больше учеников" });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const me = (await (await app.request("/api/me", { headers: cookie }, env)).json()) as { orgs: { name: string; goal: string }[] };
    expect(me.orgs.map((o) => [o.name, o.goal])).toEqual([["freekonomist", ""], ["Brainax", "Больше учеников"]]);
    const agents = (await (await app.request(`/api/orgs/${id}/agents`, { headers: cookie }, env)).json()) as unknown[];
    expect(agents).toHaveLength(6);
    // Another user cannot see the new project.
    expect((await app.request(`/api/orgs/${id}/agents`, { headers: await as("u-b") }, env)).status).toBe(404);
  });

  it("signs in with the right password only, and /api/me follows the cookie", async () => {
    await signup(owner);
    expect((await login("owner@example.com", "wrong password")).status).toBe(401);
    expect((await login("nobody@example.com", "correct horse")).status).toBe(401);
    const ok = await login("OWNER@example.com", "correct horse");
    expect(ok.status).toBe(200);
    const me = await app.request("/api/me", { headers: { Cookie: cookieOf(ok) } }, env);
    expect(((await me.json()) as { user: { name: string } }).user.name).toBe("Арут");
    expect((await app.request("/api/me", {}, env)).status).toBe(401);
  });

  it("slows down password guessing", async () => {
    await signup(owner);
    for (let i = 0; i < 10; i++) expect((await login("owner@example.com", `guess ${i}`)).status).toBe(401);
    expect((await login("owner@example.com", "correct horse")).status).toBe(429);
  });

  it("signs out by clearing the cookie", async () => {
    const res = await app.request("/api/auth/logout", { method: "POST" }, env);
    expect(res.headers.get("Set-Cookie")).toMatch(/sid=;.*Max-Age=0/);
  });

  it("works without a configured secret by generating one and keeping it", async () => {
    const bare: Env = { DB: createTestDb().d1, SIGNUP_CODES: "EARLY" };
    const res = await signup(owner, bare);
    expect(res.status).toBe(201);
    const me = await app.request("/api/me", { headers: { Cookie: cookieOf(res) } }, bare);
    expect(me.status).toBe(200);
  });
});

describe("password reset", () => {
  const json = { "Content-Type": "application/json" };
  const post = (path: string, body: Record<string, unknown>, e: Env) =>
    app.request(path, { method: "POST", headers: json, body: JSON.stringify(body) }, e);
  const owner = { email: "owner@example.com", password: "correct horse", name: "Арут", orgName: "freekonomist", promo: "early" };

  function withOutbox() {
    const outbox: Mail[] = [];
    const e: Env = { ...env, sendMail: async (m) => { outbox.push(m); return true; } };
    const linkToken = () => /#reset=([\w-]+)/.exec(outbox.at(-1)?.text ?? "")?.[1] ?? "";
    return { e, outbox, linkToken };
  }

  it("emails a one-time link that sets a new password and signs in", async () => {
    const { e, outbox, linkToken } = withOutbox();
    await post("/api/auth/signup", owner, e);
    expect((await post("/api/auth/forgot", { email: "OWNER@example.com" }, e)).status).toBe(200);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe("owner@example.com");
    const token = linkToken();
    expect(token).not.toBe("");

    expect((await post("/api/auth/reset", { token, password: "short" }, e)).status).toBe(400);
    const res = await post("/api/auth/reset", { token, password: "new password 1" }, e);
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toMatch(/sid=/);
    // The link works once, and the new password replaces the old one.
    expect((await post("/api/auth/reset", { token, password: "new password 2" }, e)).status).toBe(400);
    expect((await post("/api/auth/login", { email: owner.email, password: "correct horse" }, e)).status).toBe(401);
    expect((await post("/api/auth/login", { email: owner.email, password: "new password 1" }, e)).status).toBe(200);
  });

  it("answers the same for unknown emails and limits how many links are sent", async () => {
    const { e, outbox } = withOutbox();
    expect((await post("/api/auth/forgot", { email: "nobody@example.com" }, e)).status).toBe(200);
    expect(outbox).toHaveLength(0);
    await post("/api/auth/signup", owner, e);
    for (let i = 0; i < 5; i++) expect((await post("/api/auth/forgot", { email: owner.email }, e)).status).toBe(200);
    expect(outbox).toHaveLength(3);
  });

  it("rejects made-up links and says when email is not set up", async () => {
    const { e } = withOutbox();
    expect((await post("/api/auth/reset", { token: "made-up", password: "new password 1" }, e)).status).toBe(400);
    expect((await post("/api/auth/forgot", { email: owner.email }, env)).status).toBe(503);
  });
});

describe("landing requests", () => {
  const json = { "Content-Type": "application/json" };
  const lead = (body: Record<string, unknown>, e: Env = env) =>
    app.request("/api/leads", { method: "POST", headers: json, body: JSON.stringify(body) }, e);

  it("stores a valid request and emails it to the owner when configured", async () => {
    const outbox: Mail[] = [];
    const e: Env = { ...env, LEADS_EMAIL: "owner@example.com", sendMail: async (m) => { outbox.push(m); return true; } };
    expect((await lead({ kind: "enterprise", name: "Анна", email: "anna@corp.com", company: "Corp", message: "Нужен колл-центр" }, e)).status).toBe(201);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe("owner@example.com");
    expect(outbox[0]!.text).toContain("anna@corp.com");
    // Without email settings the request is still saved.
    expect((await lead({ kind: "access", name: "Борис", email: "b@example.com" })).status).toBe(201);
  });

  it("rejects bad input", async () => {
    expect((await lead({ kind: "spam", name: "A", email: "a@example.com" })).status).toBe(400);
    expect((await lead({ kind: "access", name: "", email: "a@example.com" })).status).toBe(400);
    expect((await lead({ kind: "access", name: "A", email: "nope" })).status).toBe(400);
    expect((await lead({ kind: "access", name: "A", email: "a@example.com", message: "x".repeat(2001) })).status).toBe(400);
  });
});
