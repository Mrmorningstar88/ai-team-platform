import { beforeEach, describe, expect, it } from "vitest";
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
  env = { DB: d1, SESSION_SECRET: SECRET };
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
  const owner = { email: "Owner@Example.com", password: "correct horse", name: "Арут", orgName: "freekonomist" };

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
    expect((await app.request("/api/auth/signup", { method: "POST", body: JSON.stringify(owner) }, env)).status).toBe(400);
    expect((await signup(owner)).status).toBe(201);
    expect((await signup({ ...owner, email: "OWNER@example.com" })).status).toBe(409);
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
    const bare: Env = { DB: createTestDb().d1 };
    const res = await signup(owner, bare);
    expect(res.status).toBe(201);
    const me = await app.request("/api/me", { headers: { Cookie: cookieOf(res) } }, bare);
    expect(me.status).toBe(200);
  });
});
