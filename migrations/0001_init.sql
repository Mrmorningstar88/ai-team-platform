-- Every tenant-owned table carries org_id. The Worker reaches these tables
-- only through src/worker/tenant.ts, which binds org_id on every query.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE orgs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  goal        TEXT NOT NULL DEFAULT '',
  plan        TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'start', 'business')),
  -- Monthly AI budget in cents; agents stop when spent_cents reaches it.
  ai_budget_cents INTEGER NOT NULL DEFAULT 2000 CHECK (ai_budget_cents >= 0),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE memberships (
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'viewer')),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE agents (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  name        TEXT NOT NULL,
  -- L0 report only, L1 change via approval, L2 auto after checks, L3 external actions.
  autonomy    TEXT NOT NULL DEFAULT 'L1' CHECK (autonomy IN ('L0', 'L1', 'L2', 'L3')),
  status      TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'waiting', 'paused')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX agents_org ON agents(org_id);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  -- Index into the agent's process steps, shown animated in the UI.
  step        INTEGER NOT NULL DEFAULT 0 CHECK (step >= 0),
  state       TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'needs_approval', 'done', 'failed')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX tasks_org ON tasks(org_id, updated_at);

CREATE TABLE approvals (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  summary     TEXT NOT NULL,
  decision    TEXT CHECK (decision IN ('approved', 'rejected')),
  decided_by  TEXT REFERENCES users(id),
  decided_at  TEXT
);
CREATE INDEX approvals_org ON approvals(org_id, decision);

CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  author      TEXT NOT NULL CHECK (author IN ('owner', 'ceo')),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX messages_org ON messages(org_id, created_at);

-- Append-only record of everything agents did, for the owner and for audits.
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX audit_org ON audit_log(org_id, created_at);
