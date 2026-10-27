-- Live status of a team that runs elsewhere (for now: GitHub Actions bots).
-- A feed is keyed by the repository and project it reports for, and belongs to
-- the owner email it names. An organization shows at most one feed.
CREATE TABLE team_feeds (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  project TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_ms INTEGER NOT NULL
);
CREATE INDEX team_feeds_owner ON team_feeds(owner_email);
CREATE TABLE org_feeds (
  org_id TEXT PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  feed_id TEXT NOT NULL REFERENCES team_feeds(id) ON DELETE CASCADE,
  linked_ms INTEGER NOT NULL
);
