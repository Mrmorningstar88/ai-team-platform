// The database schema as it stands after every file in migrations/, so a fresh
// D1 database works on first request without anyone running migrations by hand.
// test/schema.test.ts keeps this in step with migrations/.

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    password_hash TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'start', 'business')),
    ai_budget_cents INTEGER NOT NULL DEFAULT 2000 CHECK (ai_budget_cents >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'viewer')),
    PRIMARY KEY (org_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    autonomy TEXT NOT NULL DEFAULT 'L1' CHECK (autonomy IN ('L0', 'L1', 'L2', 'L3')),
    status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'waiting', 'paused')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS agents_org ON agents(org_id)`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    step INTEGER NOT NULL DEFAULT 0 CHECK (step >= 0),
    state TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'needs_approval', 'done', 'failed')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS tasks_org ON tasks(org_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    decision TEXT CHECK (decision IN ('approved', 'rejected')),
    decided_by TEXT REFERENCES users(id),
    decided_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS approvals_org ON approvals(org_id, decision)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    author TEXT NOT NULL CHECK (author IN ('owner', 'ceo')),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS messages_org ON messages(org_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS audit_org ON audit_log(org_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_failures (
    email TEXT NOT NULL,
    at_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS login_failures_email ON login_failures(email, at_ms)`,
  `CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_ms INTEGER NOT NULL,
    created_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id, created_ms)`,
  `CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('access', 'enterprise')),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    created_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS leads_created ON leads(created_ms)`,
];

const ready = new WeakSet<D1Database>();

/** Creates any missing tables once per database binding; cheap no-op afterwards. */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  ready.add(db);
}
