-- LinkPulse schema, version 001.
-- Applied by `npm run migrate` (server/src/migrate.ts), which records each file in schema_migrations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Users & sessions ──────────────────────────────────────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL CHECK (char_length(email) <= 254),
  password_hash text NOT NULL,                 -- bcrypt hash, never plaintext
  display_name  text CHECK (char_length(display_name) <= 80),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,            -- SHA-256 of the cookie token; the raw token is never stored
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ── Campaigns & tags ──────────────────────────────────────────────
CREATE TABLE campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description   text CHECK (char_length(description) <= 500),
  utm_source    text CHECK (char_length(utm_source) <= 100),
  utm_medium    text CHECK (char_length(utm_medium) <= 100),
  utm_campaign  text CHECK (char_length(utm_campaign) <= 100),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX campaigns_user_name_idx ON campaigns (user_id, lower(name));

CREATE TABLE tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  color       text NOT NULL DEFAULT '#6366f1' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tags_user_name_idx ON tags (user_id, lower(name));

-- ── Links ─────────────────────────────────────────────────────────
CREATE TABLE links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code              text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  destination_url   text NOT NULL CHECK (char_length(destination_url) <= 2048),
  title             text CHECK (char_length(title) <= 120),
  is_custom_alias   boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  expires_at        timestamptz,
  password_hash     text,                      -- bcrypt hash; NULL means no password
  max_clicks        integer CHECK (max_clicks > 0),
  click_count       integer NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  campaign_id       uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  safety_status     text NOT NULL DEFAULT 'format_valid'
                    CHECK (safety_status IN ('format_valid', 'no_known_issue', 'suspicious', 'blocked')),
  safety_reasons    jsonb NOT NULL DEFAULT '[]'::jsonb,
  safety_checked_at timestamptz,
  last_clicked_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT click_count_within_limit CHECK (max_clicks IS NULL OR click_count <= max_clicks)
);
CREATE INDEX links_user_created_idx ON links (user_id, created_at DESC);
CREATE INDEX links_campaign_idx ON links (campaign_id);

CREATE TABLE link_tags (
  link_id  uuid NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  tag_id   uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (link_id, tag_id)
);
CREATE INDEX link_tags_tag_idx ON link_tags (tag_id);

-- ── Click events (analytics) ─────────────────────────────────────
-- Deliberately privacy-light: no IP address, no full user-agent, no location.
CREATE TABLE click_events (
  id             bigserial PRIMARY KEY,
  link_id        uuid NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  clicked_at     timestamptz NOT NULL DEFAULT now(),
  referrer_host  text,                         -- host only, e.g. "twitter.com"; NULL = direct / unknown
  device_type    text NOT NULL DEFAULT 'unknown'
                 CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'bot', 'unknown')),
  browser        text,
  os             text,
  campaign_id    uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  utm_source     text,
  utm_medium     text,
  utm_campaign   text
);
CREATE INDEX click_events_link_time_idx ON click_events (link_id, clicked_at DESC);
CREATE INDEX click_events_campaign_idx ON click_events (campaign_id);

-- ── Safety ───────────────────────────────────────────────────────
CREATE TABLE safety_checks (
  id          bigserial PRIMARY KEY,
  link_id     uuid REFERENCES links(id) ON DELETE CASCADE,
  url         text NOT NULL,
  status      text NOT NULL CHECK (status IN ('format_valid', 'no_known_issue', 'suspicious', 'blocked')),
  reasons     jsonb NOT NULL DEFAULT '[]'::jsonb,
  providers   text[] NOT NULL DEFAULT '{}',
  checked_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX safety_checks_link_idx ON safety_checks (link_id, checked_at DESC);

-- Operator-managed blocklist (in addition to BLOCKLIST_DOMAINS env var).
CREATE TABLE blocked_domains (
  domain      text PRIMARY KEY CHECK (domain = lower(domain)),
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
