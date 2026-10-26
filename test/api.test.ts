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
