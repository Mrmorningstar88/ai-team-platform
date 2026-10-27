-- Email + password sign-in. The hash is "pbkdf2$<iterations>$<salt>$<hash>"
-- (base64url); NULL means the account cannot sign in with a password.
ALTER TABLE users ADD COLUMN password_hash TEXT;

-- Values the server generates for itself on first start, e.g. the session key.
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL
);

-- Failed sign-ins per email, used to slow down password guessing.
CREATE TABLE login_failures (
  email       TEXT NOT NULL,
  at_ms       INTEGER NOT NULL
);
CREATE INDEX login_failures_email ON login_failures(email, at_ms);
