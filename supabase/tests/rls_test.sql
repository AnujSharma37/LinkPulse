-- Tests for the Supabase migration. Run: ./supabase/tests/run.sh   (fails loudly on the first broken assertion)
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'ASSERTION FAILED: %', msg; END IF; END $$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '{"display_name":"Alice"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com', '{}');
SELECT pg_temp.assert((SELECT display_name FROM profiles WHERE id = '11111111-1111-1111-1111-111111111111') = 'Alice', 'profile trigger');

-- ── service role creates links (what the create-link Edge Function does) ──
SET ROLE service_role;
SELECT set_config('lp.a1', (lp_create_link('11111111-1111-1111-1111-111111111111', 'https://example.com/a', NULL, 'A', NULL, NULL, NULL, NULL, NULL, 'format_valid', '[]', '{heuristics}')).id::text, false);
SELECT set_config('lp.pw', (lp_create_link('11111111-1111-1111-1111-111111111111', 'https://example.com/pw', 'Secret-Link', NULL, NULL, 'open-sesame', 2, NULL, NULL, 'format_valid', '[]', '{}')).id::text, false);
SELECT pg_temp.assert((SELECT code FROM links WHERE id = current_setting('lp.a1')::uuid) ~ '^[a-z2-9]{7}$', 'random code format');
SELECT pg_temp.assert((SELECT code FROM links WHERE id = current_setting('lp.pw')::uuid) = 'secret-link', 'alias lowercased');
SELECT pg_temp.assert((SELECT password_hash FROM links WHERE code = 'secret-link') LIKE '$2a$%', 'bcrypt hash stored');

DO $$ BEGIN
  PERFORM lp_create_link('22222222-2222-2222-2222-222222222222', 'https://x.example', 'SECRET-link', NULL, NULL, NULL, NULL, NULL, NULL, 'format_valid', '[]', '{}');
  RAISE EXCEPTION 'ASSERTION FAILED: duplicate alias accepted';
EXCEPTION WHEN unique_violation THEN NULL; END $$;
DO $$ BEGIN
  PERFORM lp_create_link('22222222-2222-2222-2222-222222222222', 'https://x.example', NULL, NULL, now() - interval '1 day', NULL, NULL, NULL, NULL, 'format_valid', '[]', '{}');
  RAISE EXCEPTION 'ASSERTION FAILED: past expiry accepted';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;

-- ── redirects ──
SELECT pg_temp.assert(lp_resolve_link('nope-nope')->>'outcome' = 'not_found', 'missing link');
SELECT pg_temp.assert(lp_resolve_link('secret-link')->>'outcome' = 'password_required', 'password required');
SELECT pg_temp.assert(lp_resolve_link('secret-link', 'wrong')->>'outcome' = 'wrong_password', 'wrong password rejected');
SELECT pg_temp.assert(lp_resolve_link('SECRET-LINK', 'open-sesame', false, true, 't.co', 'mobile')->>'destination' = 'https://example.com/pw', 'right password redirects');
SELECT pg_temp.assert(lp_resolve_link('secret-link', 'open-sesame')->>'outcome' = 'redirect', 'second click ok');
SELECT pg_temp.assert(lp_resolve_link('secret-link', 'open-sesame')->>'outcome' = 'limit_reached', 'click limit enforced');
SELECT pg_temp.assert((SELECT count(*) FROM click_events e JOIN links l ON l.id = e.link_id WHERE l.code = 'secret-link') = 2, 'two events recorded');
SELECT pg_temp.assert(lp_resolve_link((SELECT code FROM links WHERE id = current_setting('lp.a1')::uuid), NULL, false, false)->>'outcome' = 'ok_no_consume', 'HEAD does not consume');

INSERT INTO blocked_domains (domain) VALUES ('example.com');
SELECT pg_temp.assert(lp_resolve_link((SELECT code FROM links WHERE id = current_setting('lp.a1')::uuid))->>'outcome' = 'blocked', 'blocklist at redirect');
DELETE FROM blocked_domains;
RESET ROLE;

-- ── RLS as Alice ──
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
SELECT pg_temp.assert((SELECT count(*) FROM links) = 2, 'alice sees her 2 links');
SELECT pg_temp.assert((SELECT count(*) FROM click_events) = 2, 'alice sees her click events');
UPDATE links SET status = 'disabled' WHERE id = current_setting('lp.a1')::uuid;
INSERT INTO campaigns (name, utm_source) VALUES ('Alice camp', 'poster');
INSERT INTO tags (name) VALUES ('alice-tag');
SELECT set_config('lp.tag', (SELECT id::text FROM tags WHERE name = 'alice-tag'), false);
DO $$ BEGIN
  PERFORM password_hash FROM links;
  RAISE EXCEPTION 'ASSERTION FAILED: password_hash readable';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  UPDATE links SET click_count = 0;
  RAISE EXCEPTION 'ASSERTION FAILED: click_count writable';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  UPDATE links SET destination_url = 'https://evil.example';
  RAISE EXCEPTION 'ASSERTION FAILED: destination writable directly';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO links (user_id, code, destination_url) VALUES (auth.uid(), 'direct-insert', 'https://x.example');
  RAISE EXCEPTION 'ASSERTION FAILED: direct insert allowed';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO click_events (link_id) VALUES (current_setting('lp.a1')::uuid);
  RAISE EXCEPTION 'ASSERTION FAILED: fake click insert allowed';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM lp_resolve_link('secret-link');
  RAISE EXCEPTION 'ASSERTION FAILED: client can call lp_resolve_link';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  UPDATE links SET max_clicks = 1 WHERE code = 'secret-link';
  RAISE EXCEPTION 'ASSERTION FAILED: limit below used clicks accepted';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
SELECT pg_temp.assert((SELECT count(*) FROM blocked_domains) = 0, 'blocklist hidden (RLS, no policy)');

-- ── RLS as Bob ──
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
SELECT pg_temp.assert((SELECT count(*) FROM links) = 0, 'bob sees no links');
SELECT pg_temp.assert((SELECT count(*) FROM click_events) = 0, 'bob sees no clicks');
SELECT pg_temp.assert((SELECT count(*) FROM campaigns) = 0, 'bob sees no campaigns');
SELECT pg_temp.assert((SELECT count(*) FROM lp_daily_clicks(current_setting('lp.a1')::uuid, 7) WHERE clicks > 0) = 0, 'bob gets no analytics for alice link');
UPDATE links SET status = 'active' WHERE id = current_setting('lp.a1')::uuid;   -- silently affects 0 rows
DELETE FROM links WHERE id = current_setting('lp.pw')::uuid;
DO $$ BEGIN
  INSERT INTO campaigns (user_id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'spoofed owner');
  RAISE EXCEPTION 'ASSERTION FAILED: bob created campaign for alice';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO link_tags (link_id, tag_id) VALUES (current_setting('lp.a1')::uuid, current_setting('lp.tag')::uuid);
  RAISE EXCEPTION 'ASSERTION FAILED: bob tagged alice link';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

-- ── anon sees nothing ──
SET ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$ BEGIN
  PERFORM count(*) FROM links;
  RAISE EXCEPTION 'ASSERTION FAILED: anon can query links';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT pg_temp.assert((SELECT count(*) FROM campaigns) = 0, 'anon sees no campaigns');
RESET ROLE;

SELECT pg_temp.assert((SELECT status FROM links WHERE id = current_setting('lp.a1')::uuid) = 'disabled', 'alice disable stuck, bob re-enable ignored');
SELECT pg_temp.assert(EXISTS (SELECT 1 FROM links WHERE id = current_setting('lp.pw')::uuid), 'bob could not delete alice link');

-- ── concurrency-safe limit: simulate with 5 sequential attempts at limit 3 ──
SET ROLE service_role;
SELECT set_config('lp.lim', (lp_create_link('22222222-2222-2222-2222-222222222222', 'https://example.org', NULL, NULL, NULL, NULL, 3, NULL, NULL, 'format_valid', '[]', '{}')).code, false);
SELECT pg_temp.assert((SELECT count(*) FROM generate_series(1, 5) g WHERE lp_resolve_link(current_setting('lp.lim'))->>'outcome' = 'redirect') = 3, 'exactly 3 of 5 succeed');
RESET ROLE;

\echo 'ALL SUPABASE SQL TESTS PASSED'
