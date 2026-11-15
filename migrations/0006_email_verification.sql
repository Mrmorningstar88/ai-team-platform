-- A team feed names its owner by email, so it is only shown to a user who
-- proved they read that inbox. Users from before this check keep their access.
ALTER TABLE users ADD COLUMN email_verified_ms INTEGER;
UPDATE users SET email_verified_ms = CAST(strftime('%s', created_at) AS INTEGER) * 1000 WHERE email_verified_ms IS NULL;
-- One-time links from the sign-up email; only a SHA-256 hash of the token is stored.
CREATE TABLE email_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_ms INTEGER NOT NULL,
  created_ms INTEGER NOT NULL
);
CREATE INDEX email_verifications_user ON email_verifications(user_id);
