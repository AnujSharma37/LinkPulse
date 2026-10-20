-- LinkPulse — Supabase variant (alternative to the Node API).
-- Uses Supabase Auth (auth.users), Row Level Security, and SECURITY DEFINER functions.
-- Apply with:  supabase db push   (or paste into the SQL editor).

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── Profiles ─────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text CHECK (char_length(display_name) <= 80),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, left(NEW.raw_user_meta_data->>'display_name', 80));
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Campaigns & tags ─────────────────────────────────────────────
CREATE TABLE public.campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description   text CHECK (char_length(description) <= 500),
  utm_source    text CHECK (utm_source ~ '^[\w.\-+ ]{0,100}$'),
  utm_medium    text CHECK (utm_medium ~ '^[\w.\-+ ]{0,100}$'),
  utm_campaign  text CHECK (utm_campaign ~ '^[\w.\-+ ]{0,100}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX campaigns_user_name_idx ON public.campaigns (user_id, lower(name));

CREATE TABLE public.tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  color       text NOT NULL DEFAULT '#6366f1' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tags_user_name_idx ON public.tags (user_id, lower(name));

-- ── Links ────────────────────────────────────────────────────────
CREATE TABLE public.links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code              text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  destination_url   text NOT NULL CHECK (char_length(destination_url) <= 2048 AND destination_url ~* '^https?://'),
  title             text CHECK (char_length(title) <= 120),
  is_custom_alias   boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  expires_at        timestamptz,
  password_hash     text,
  max_clicks        integer CHECK (max_clicks > 0),
  click_count       integer NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  campaign_id       uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  safety_status     text NOT NULL DEFAULT 'format_valid'
                    CHECK (safety_status IN ('format_valid', 'no_known_issue', 'suspicious', 'blocked')),
  safety_reasons    jsonb NOT NULL DEFAULT '[]'::jsonb,
  safety_checked_at timestamptz,
  last_clicked_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT click_count_within_limit CHECK (max_clicks IS NULL OR click_count <= max_clicks)
);
CREATE INDEX links_user_created_idx ON public.links (user_id, created_at DESC);
CREATE INDEX links_campaign_idx ON public.links (campaign_id);

CREATE TABLE public.link_tags (
  link_id  uuid NOT NULL REFERENCES public.links(id) ON DELETE CASCADE,
  tag_id   uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (link_id, tag_id)
);
CREATE INDEX link_tags_tag_idx ON public.link_tags (tag_id);

CREATE TABLE public.click_events (
  id             bigserial PRIMARY KEY,
  link_id        uuid NOT NULL REFERENCES public.links(id) ON DELETE CASCADE,
  clicked_at     timestamptz NOT NULL DEFAULT now(),
  referrer_host  text,
  device_type    text NOT NULL DEFAULT 'unknown' CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'bot', 'unknown')),
  browser        text,
  os             text,
  campaign_id    uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  utm_source     text,
  utm_medium     text,
  utm_campaign   text
);
CREATE INDEX click_events_link_time_idx ON public.click_events (link_id, clicked_at DESC);

CREATE TABLE public.safety_checks (
  id          bigserial PRIMARY KEY,
  link_id     uuid REFERENCES public.links(id) ON DELETE CASCADE,
  url         text NOT NULL,
  status      text NOT NULL CHECK (status IN ('format_valid', 'no_known_issue', 'suspicious', 'blocked')),
  reasons     jsonb NOT NULL DEFAULT '[]'::jsonb,
  providers   text[] NOT NULL DEFAULT '{}',
  checked_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX safety_checks_link_idx ON public.safety_checks (link_id, checked_at DESC);

CREATE TABLE public.blocked_domains (
  domain      text PRIMARY KEY CHECK (domain = lower(domain)),
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Row Level Security ───────────────────────────────────────────
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_tags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.click_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_checks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_domains ENABLE ROW LEVEL SECURITY;  -- no policies: invisible to clients

CREATE POLICY "own profile read"   ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "own campaigns" ON public.campaigns FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own tags" ON public.tags FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Links: clients may read and delete their own rows and update a few safe columns.
-- Creating links and changing destination/password goes through the create-link / update-link
-- Edge Functions (server-side URL validation, safety checks, password hashing).
CREATE POLICY "own links read"   ON public.links FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own links update" ON public.links FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own links delete" ON public.links FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.links FROM anon, authenticated;
GRANT SELECT (id, user_id, code, destination_url, title, is_custom_alias, status, expires_at, max_clicks, click_count,
              campaign_id, safety_status, safety_reasons, safety_checked_at, last_clicked_at, created_at, updated_at)
  ON public.links TO authenticated;                          -- password_hash is never readable by clients
GRANT UPDATE (title, status, expires_at, max_clicks, campaign_id) ON public.links TO authenticated;
GRANT DELETE ON public.links TO authenticated;

CREATE POLICY "own link tags" ON public.link_tags FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.links l WHERE l.id = link_id AND l.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.links l WHERE l.id = link_id AND l.user_id = auth.uid())
          AND EXISTS (SELECT 1 FROM public.tags t WHERE t.id = tag_id AND t.user_id = auth.uid()));

-- Click events are written only by lp_consume_click (SECURITY DEFINER); owners can read theirs.
CREATE POLICY "own click events" ON public.click_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.links l WHERE l.id = link_id AND l.user_id = auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.click_events FROM anon, authenticated;

CREATE POLICY "own safety checks" ON public.safety_checks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.links l WHERE l.id = link_id AND l.user_id = auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.safety_checks FROM anon, authenticated;

-- ── Integrity triggers ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lp_links_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM campaigns c WHERE c.id = NEW.campaign_id AND c.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Campaign not found.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.max_clicks IS NOT NULL AND NEW.max_clicks < NEW.click_count THEN
      RAISE EXCEPTION 'Click limit can''t be lower than the clicks already used (%).', NEW.click_count USING ERRCODE = '22023';
    END IF;
    IF NEW.expires_at IS DISTINCT FROM OLD.expires_at AND NEW.expires_at IS NOT NULL AND NEW.expires_at <= now() THEN
      RAISE EXCEPTION 'Expiry date must be in the future.' USING ERRCODE = '22023';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER links_guard BEFORE INSERT OR UPDATE ON public.links FOR EACH ROW EXECUTE FUNCTION public.lp_links_guard();

-- ── Short-code generation (service role only) ────────────────────
CREATE OR REPLACE FUNCTION public.lp_random_code(len int DEFAULT 7) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet constant text := 'abcdefghijkmnopqrstuvwxyz23456789';
  bytes bytea := extensions.gen_random_bytes(len * 2);
  out text := '';
  i int := 0;
  v int;
BEGIN
  -- Rejection sampling over 16-bit values avoids modulo bias (33 * 1985 = 65505).
  WHILE char_length(out) < len LOOP
    IF i >= length(bytes) - 1 THEN bytes := extensions.gen_random_bytes(len * 2); i := 0; END IF;
    v := get_byte(bytes, i) * 256 + get_byte(bytes, i + 1);
    i := i + 2;
    IF v < 65505 THEN out := out || substr(alphabet, (v % 33) + 1, 1); END IF;
  END LOOP;
  RETURN out;
END $$;

/**
 * Create a link. Called by the create-link Edge Function with the service role after it has
 * authenticated the user, validated the URL and run safety checks. Hashes the password with bcrypt.
 */
CREATE OR REPLACE FUNCTION public.lp_create_link(
  p_user_id uuid, p_destination text, p_alias text, p_title text, p_expires_at timestamptz,
  p_password text, p_max_clicks int, p_campaign_id uuid, p_tag_ids uuid[],
  p_safety_status text, p_safety_reasons jsonb, p_providers text[]
) RETURNS public.links
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  rec links;
  attempt int := 0;
BEGIN
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'Expiry date must be in the future.' USING ERRCODE = '22023';
  END IF;
  IF p_password IS NOT NULL AND char_length(p_password) NOT BETWEEN 4 AND 128 THEN
    RAISE EXCEPTION 'Link password must be 4-128 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_tag_ids IS NOT NULL AND cardinality(p_tag_ids) > 0 AND
     (SELECT count(*) FROM tags WHERE id = ANY(p_tag_ids) AND user_id = p_user_id) <> cardinality(ARRAY(SELECT DISTINCT unnest(p_tag_ids))) THEN
    RAISE EXCEPTION 'One or more tags were not found.' USING ERRCODE = '22023';
  END IF;

  LOOP
    BEGIN
      INSERT INTO links (user_id, code, destination_url, title, is_custom_alias, expires_at, password_hash, max_clicks,
                         campaign_id, safety_status, safety_reasons, safety_checked_at)
      VALUES (p_user_id, COALESCE(lower(p_alias), lp_random_code()), p_destination, NULLIF(p_title, ''), p_alias IS NOT NULL,
              p_expires_at, CASE WHEN p_password IS NULL THEN NULL ELSE crypt(p_password, gen_salt('bf', 10)) END,
              p_max_clicks, p_campaign_id, p_safety_status, COALESCE(p_safety_reasons, '[]'::jsonb), now())
      RETURNING * INTO rec;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF p_alias IS NOT NULL THEN
        RAISE EXCEPTION 'The alias "%" is already taken.', lower(p_alias) USING ERRCODE = '23505';
      END IF;
      attempt := attempt + 1;
      IF attempt >= 5 THEN RAISE EXCEPTION 'Could not generate a unique short code.'; END IF;
    END;
  END LOOP;

  IF p_tag_ids IS NOT NULL THEN
    INSERT INTO link_tags (link_id, tag_id) SELECT rec.id, t FROM (SELECT DISTINCT unnest(p_tag_ids) AS t) x;
  END IF;
  INSERT INTO safety_checks (link_id, url, status, reasons, providers)
  VALUES (rec.id, p_destination, p_safety_status, COALESCE(p_safety_reasons, '[]'::jsonb), COALESCE(p_providers, '{}'));
  RETURN rec;
END $$;

/** Change destination and/or password (service role only; Edge Function validates first). */
CREATE OR REPLACE FUNCTION public.lp_update_link_secure(
  p_user_id uuid, p_link_id uuid, p_destination text, p_safety_status text, p_safety_reasons jsonb,
  p_set_password boolean, p_password text
) RETURNS public.links
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE rec links;
BEGIN
  UPDATE links SET
    destination_url   = COALESCE(p_destination, destination_url),
    safety_status     = CASE WHEN p_destination IS NULL THEN safety_status ELSE p_safety_status END,
    safety_reasons    = CASE WHEN p_destination IS NULL THEN safety_reasons ELSE COALESCE(p_safety_reasons, '[]'::jsonb) END,
    safety_checked_at = CASE WHEN p_destination IS NULL THEN safety_checked_at ELSE now() END,
    password_hash     = CASE WHEN NOT p_set_password THEN password_hash
                             WHEN p_password IS NULL THEN NULL
                             ELSE crypt(p_password, gen_salt('bf', 10)) END
  WHERE id = p_link_id AND user_id = p_user_id
  RETURNING * INTO rec;
  IF rec.id IS NULL THEN RAISE EXCEPTION 'Link not found.' USING ERRCODE = 'P0002'; END IF;
  IF p_destination IS NOT NULL THEN
    INSERT INTO safety_checks (link_id, url, status, reasons) VALUES (rec.id, p_destination, p_safety_status, COALESCE(p_safety_reasons, '[]'::jsonb));
  END IF;
  RETURN rec;
END $$;

/**
 * Resolve a short code for the redirect Edge Function. Returns the state of the link and, only when
 * every rule passes, atomically consumes one click and records the event.
 *   p_password  : the visitor's password attempt (NULL if none submitted)
 *   p_confirmed : visitor confirmed the suspicious-link warning
 *   p_consume   : false for HEAD requests / previews
 * result.outcome ∈ not_found | disabled | expired | limit_reached | blocked | password_required |
 *                  wrong_password | warning | redirect
 */
CREATE OR REPLACE FUNCTION public.lp_resolve_link(
  p_code text, p_password text DEFAULT NULL, p_confirmed boolean DEFAULT false, p_consume boolean DEFAULT true,
  p_referrer_host text DEFAULT NULL, p_device text DEFAULT 'unknown', p_browser text DEFAULT NULL, p_os text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  l links;
  c campaigns;
  host text;
  warnings jsonb;
  target text;
BEGIN
  SELECT * INTO l FROM links WHERE code = lower(p_code);
  IF l.id IS NULL THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  IF l.status <> 'active' THEN RETURN jsonb_build_object('outcome', 'disabled'); END IF;
  IF l.expires_at IS NOT NULL AND l.expires_at <= now() THEN RETURN jsonb_build_object('outcome', 'expired'); END IF;
  IF l.max_clicks IS NOT NULL AND l.click_count >= l.max_clicks THEN RETURN jsonb_build_object('outcome', 'limit_reached'); END IF;

  host := lower(substring(l.destination_url FROM '^[a-zA-Z]+://(?:[^@/]*@)?([^/:?#]+)'));
  IF l.safety_status = 'blocked' OR EXISTS (
       SELECT 1 FROM blocked_domains b WHERE host = b.domain OR host LIKE '%.' || b.domain) THEN
    RETURN jsonb_build_object('outcome', 'blocked');
  END IF;

  SELECT COALESCE(jsonb_agg(r->>'message'), '[]'::jsonb) INTO warnings
    FROM jsonb_array_elements(l.safety_reasons) r WHERE l.safety_status = 'suspicious' AND r->>'severity' = 'warning';

  IF l.password_hash IS NOT NULL THEN
    IF p_password IS NULL THEN RETURN jsonb_build_object('outcome', 'password_required', 'warnings', warnings); END IF;
    IF crypt(p_password, l.password_hash) <> l.password_hash THEN
      RETURN jsonb_build_object('outcome', 'wrong_password', 'warnings', warnings);
    END IF;
  ELSIF jsonb_array_length(warnings) > 0 AND NOT p_confirmed THEN
    RETURN jsonb_build_object('outcome', 'warning', 'warnings', warnings, 'destination', l.destination_url);
  END IF;

  IF NOT p_consume THEN RETURN jsonb_build_object('outcome', 'ok_no_consume'); END IF;

  -- Atomic: re-check every rule inside the UPDATE so concurrent visitors can't exceed the limit.
  UPDATE links SET click_count = click_count + 1, last_clicked_at = now()
   WHERE id = l.id AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
     AND (max_clicks IS NULL OR click_count < max_clicks);
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'limit_reached'); END IF;

  SELECT * INTO c FROM campaigns WHERE id = l.campaign_id;
  target := l.destination_url;
  INSERT INTO click_events (link_id, referrer_host, device_type, browser, os, campaign_id, utm_source, utm_medium, utm_campaign)
  VALUES (l.id, left(p_referrer_host, 253),
          CASE WHEN p_device IN ('desktop', 'mobile', 'tablet', 'bot') THEN p_device ELSE 'unknown' END,
          left(p_browser, 40), left(p_os, 40), l.campaign_id, c.utm_source, c.utm_medium, c.utm_campaign);
  RETURN jsonb_build_object('outcome', 'redirect', 'destination', target,
    'utm', jsonb_strip_nulls(jsonb_build_object('utm_source', c.utm_source, 'utm_medium', c.utm_medium, 'utm_campaign', c.utm_campaign)));
END $$;

-- Analytics helper for the dashboard: daily clicks for the caller's link (RLS-equivalent check inside).
CREATE OR REPLACE FUNCTION public.lp_daily_clicks(p_link_id uuid, p_days int DEFAULT 30, p_tz text DEFAULT 'UTC')
RETURNS TABLE (day date, clicks int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH d AS (
    SELECT generate_series((now() AT TIME ZONE p_tz)::date - (p_days - 1), (now() AT TIME ZONE p_tz)::date, interval '1 day')::date AS day)
  SELECT d.day, count(e.id)::int
    FROM d LEFT JOIN click_events e ON e.link_id = p_link_id AND (e.clicked_at AT TIME ZONE p_tz)::date = d.day
   GROUP BY d.day ORDER BY d.day;
$$;

-- Only the service role (Edge Functions) may call the privileged functions.
REVOKE ALL ON FUNCTION public.lp_create_link(uuid, text, text, text, timestamptz, text, int, uuid, uuid[], text, jsonb, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lp_update_link_secure(uuid, uuid, text, text, jsonb, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lp_resolve_link(text, text, boolean, boolean, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lp_random_code(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lp_create_link(uuid, text, text, text, timestamptz, text, int, uuid, uuid[], text, jsonb, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.lp_update_link_secure(uuid, uuid, text, text, jsonb, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lp_resolve_link(text, text, boolean, boolean, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lp_random_code(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.lp_daily_clicks(uuid, int, text) TO authenticated;

-- ── DB-backed rate limiting for Edge Functions (isolates don't share memory) ──
-- Keys are opaque strings such as 'unlock:<code>:<sha256(ip)>' — raw IPs are never stored.
CREATE TABLE public.lp_rate_limits (
  key           text PRIMARY KEY,
  window_start  timestamptz NOT NULL DEFAULT now(),
  hits          int NOT NULL DEFAULT 0
);
ALTER TABLE public.lp_rate_limits ENABLE ROW LEVEL SECURITY;  -- no policies: service role only
REVOKE ALL ON public.lp_rate_limits FROM anon, authenticated;

/** Count a hit; returns true while the caller is within `p_limit` hits per `p_window`. */
CREATE OR REPLACE FUNCTION public.lp_rate_limit_hit(p_key text, p_limit int, p_window interval) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  INSERT INTO lp_rate_limits AS r (key, window_start, hits) VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    hits = CASE WHEN r.window_start < now() - p_window THEN 1 ELSE r.hits + 1 END,
    window_start = CASE WHEN r.window_start < now() - p_window THEN now() ELSE r.window_start END
  RETURNING hits INTO n;
  IF random() < 0.01 THEN DELETE FROM lp_rate_limits WHERE window_start < now() - interval '1 day'; END IF;
  RETURN n <= p_limit;
END $$;
CREATE OR REPLACE FUNCTION public.lp_rate_limit_check(p_key text, p_limit int, p_window interval) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT hits < p_limit OR window_start < now() - p_window FROM lp_rate_limits WHERE key = p_key), true);
$$;
REVOKE ALL ON FUNCTION public.lp_rate_limit_hit(text, int, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lp_rate_limit_check(text, int, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lp_rate_limit_hit(text, int, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.lp_rate_limit_check(text, int, interval) TO service_role;
