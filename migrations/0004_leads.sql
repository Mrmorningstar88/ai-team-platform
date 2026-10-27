-- Requests from the landing page: early access without a promo code, or the
-- corporate plan. Not tenant data: a lead has no organization yet.
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'enterprise')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  created_ms INTEGER NOT NULL
);
CREATE INDEX leads_created ON leads(created_ms);
