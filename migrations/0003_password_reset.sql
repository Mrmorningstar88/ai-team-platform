-- One-time links for "forgot password". Only a SHA-256 hash of the token is
-- stored, so a database leak does not hand out working links.
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_ms INTEGER NOT NULL,
  created_ms INTEGER NOT NULL
);
CREATE INDEX password_resets_user ON password_resets(user_id, created_ms);
