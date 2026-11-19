-- What each project's AI has cost this month, in millionths of a dollar, so orgs.ai_budget_cents can be enforced.
CREATE TABLE ai_spend (
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  spent_micros INTEGER NOT NULL DEFAULT 0 CHECK (spent_micros >= 0),
  PRIMARY KEY (org_id, month)
);
