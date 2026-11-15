-- At most one CEO answer runs per project at a time, so parallel requests make one model call.
-- until_ms lets a claim left by a crashed request expire.
CREATE TABLE ceo_turns (
  org_id TEXT PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  until_ms INTEGER NOT NULL
);
