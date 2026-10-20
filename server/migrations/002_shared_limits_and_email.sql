-- LinkPulse schema, version 002: shared rate-limit counters, e-mail verification, password reset.

-- Rate-limit counters shared by every server instance (see src/lib/pgRateLimitStore.ts).
-- UNLOGGED = no write-ahead log, so it is fast; the only cost is that counters reset after a crash, which is harmless.
CREATE UNLOGGED TABLE rate_limits (
  key      text PRIMARY KEY,           -- "<limiter>:<client key>"
  hits     integer NOT NULL,
  reset_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_reset_idx ON rate_limits (reset_at);

-- NULL = the address has not been confirmed yet.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

-- One-time tokens e-mailed to users. Only the SHA-256 hash is stored, so a database leak can't be replayed.
CREATE TABLE auth_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,              -- set when redeemed or superseded; a token works once
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_purpose_idx ON auth_tokens (user_id, purpose);
CREATE INDEX auth_tokens_expires_idx ON auth_tokens (expires_at);
