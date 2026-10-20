# LinkPulse security audit

Scope: every source file in `linkpulse-improved.zip` (Node API, React app, Postgres migrations, Supabase RLS/functions/edge functions, CI, deploy config).

## What I could NOT do (please run these yourself)
- **Run the tests / typecheck.** The sandbox had no network, `node_modules`, Postgres or Deno. I only syntax-checked the edited TS, YAML and shell files, and I never ran the new tests. Run `npm ci && npm run typecheck && npm test` and `./supabase/tests/run.sh` before deploying.
- **Dependency audit / updates.** Needs the npm registry, which is unreachable from my sandbox (I tried). Run `npm audit --omit=dev` and apply fixes with `npm update` or Dependabot (config added). I did not hand-edit versions, because that would desync `package-lock.json` and break `npm ci` on Render/CI.
- **Git history scan.** The zip contains no `.git` folder. In your real repo run `./scripts/scan-git-history.sh` (added; needs only git and grep, tested here on a throwaway repo) and, for a deeper scan, `gitleaks detect --source . --log-opts="--all"`. If any real key was ever committed, rotate it; deleting it from the latest commit is not enough.

## Changes made
| File | Change |
|---|---|
| `.gitignore` (new) | There was none. Now ignores `.env*` (except `.env.example`), `node_modules`, `dist`, keys, logs. |
| `server/src/config.ts` | In production the server now refuses to start unless `DATABASE_URL`, `APP_ORIGIN`, `SHORT_BASE_URL` are set, `RATE_LIMIT_DISABLED` is off and `BCRYPT_COST` is 10-15. Previously it silently fell back to a localhost database with the password `postgres`. Warns if public URLs are not https. |
| `server/src/db.ts`, `.env.example` | New opt-in `DATABASE_SSL_STRICT=true` verifies the DB certificate. Default unchanged (Supabase direct connections use their own CA and would fail verification). |
| `server/src/app.ts` | `Cache-Control: no-store` on all `/api` responses; `Permissions-Policy` header. |
| `web/src/pages/Auth.tsx` | `?next=` redirect now also rejects `/\host` paths. |
| `supabase/functions/_shared/http.ts` | CORS no longer falls back to the origin `"null"` when `APP_ORIGIN` is unset. |
| `supabase/migrations/20261019000000_harden_daily_clicks.sql` (new), `supabase/tests/run.sh` | `lp_daily_clicks` accepted any `p_days`; a signed-in user could request billions of rows. Now clamped to 1-366. Test runner now applies all migrations. |
| `.github/workflows/ci.yml`, `.github/dependabot.yml` (new) | CI token is read-only; e2e step passes `DATABASE_URL` explicitly (needed by the new production check); weekly dependency PRs. |
| `server/src/migrations_placeholder` | Removed (empty, unreferenced). |

**Deploy note:** on Render, the first deploy will now fail to start until `SHORT_BASE_URL` and `APP_ORIGIN` are set (they are `sync: false`). That is intended.

## Findings fixed in the second pass
| Finding | Fix |
|---|---|
| **Medium** - edge function `r`: unlock rate limit keyed on the client-writable left-most `x-forwarded-for` | Now uses `cf-connecting-ip`, else the right-most `x-forwarded-for` entry (the one our infrastructure appended). A second, IP-independent cap of 50 failed attempts per link per 15 minutes bounds brute force even if an address is faked. |
| **Low-Medium** - login limited per IP only | New `loginAccountLimiter`: 10 failed logins per email per 15 minutes from any number of IPs (`server/src/middleware/security.ts`, used on `/auth/login`). Trade-off: someone can lock a known address out of login for 15 minutes; password reset still works. |
| **Low** - no rate limit on edge GET redirects and `update-link` | Redirects: 120 requests/min per client (skipped if the client can't be identified). `update-link`: 60/hour per user. |
| **Low** - malformed `%` in the short code caused a 500 | Returns the normal 404 page. |
| Tests | New steps in `supabase/functions/tests/functions_test.ts` for the spoofed-header case, the per-link cap, the malformed code and the `update-link` limit. The Node limiters are switched off in the Node test suite (`RATE_LIMIT_DISABLED`), so the login limiter has no automated test. |

## Still your call (not code bugs)
1. **`TRUST_PROXY` defaults to `1` in production.** Correct on Render/Railway/Fly. With no proxy in front, clients can spoof their IP and dodge IP-based limits.
2. **Verify the edge IP header on your deployment.** I could not confirm which of `cf-connecting-ip` / `x-forwarded-for` your host sets. The per-link cap still protects you if neither is trustworthy.
3. **Hygiene:** `@types/bcryptjs` is probably unnecessary with bcryptjs 3 (`npm uninstall @types/bcryptjs -w server` keeps the lockfile in sync); `style-src 'unsafe-inline'` and Google Fonts are CSP concessions; `bcryptjs` is pure JS (consider native bcrypt/argon2 at scale).

## Checked and found sound
- **Secrets:** no API keys, tokens, private keys or committed `.env` in the files; only local dev defaults. All keys come from environment variables; none reach the frontend.
- **Auth:** bcrypt (cost 12) for accounts and link passwords; session tokens 256-bit random, only SHA-256 stored, httpOnly + SameSite=Lax + Secure in production; password reset revokes all sessions; reset/verify tokens are hashed, single-use and expire; login is timing-equalised and non-enumerating.
- **Authorization:** every link/campaign/tag/analytics query includes `user_id` in the WHERE clause; foreign ids look like missing ones; campaign and tag ownership re-checked on link writes. There are **no admin routes or roles** in this codebase, so there is nothing to protect there; if you add some, gate them with an explicit role check.
- **Injection / XSS:** all SQL parameterised (dynamic parts are whitelisted); server-rendered pages escape every value; React app has no `dangerouslySetInnerHTML`/`innerHTML`; CSP forbids inline and third-party scripts; only http/https destinations are accepted; redirects only go to the stored URL.
- **CSRF / CORS:** Origin check plus JSON-only content type plus SameSite cookie; the API sets no CORS headers, so cross-origin browsers are denied by default.
- **Rate limiting:** global, login/signup, email sending (per IP and per address), link creation, redirect, and failed link-password attempts, shared across instances via Postgres.
- **Headers / debug / files:** Helmet (CSP, HSTS, nosniff, frame-ancestors none), `x-powered-by` off, generic 500 messages, no source maps, only `/assets` and `favicon.svg` are served statically.
- **Database:** RLS enabled on every Supabase table; clients cannot read `password_hash`; privileged functions are granted to `service_role` only.

## Verify after you deploy (about 5 minutes)
1. **Server starts:** with `NODE_ENV=production` and the three required URLs/DB set, `/api/health` returns `{"ok":true}`. If it exits with "Unsafe production configuration", the message names what is missing.
2. **API headers:** `curl -sI https://YOUR-DOMAIN/api/config | grep -i -E 'cache-control|strict-transport|content-security|permissions-policy'` shows `no-store`, HSTS, CSP and Permissions-Policy.
3. **Login limiter:** 11 wrong-password attempts for one email, from any IP, end in HTTP 429; a correct login before that still works.
4. **Edge IP header (Supabase only):** create a password-protected link, then send 6 wrong guesses, each with a different left-most fake address, e.g. `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'x-forwarded-for: 10.0.0.N, 1.2.3.4' -d 'password=bad' https://PROJECT.functions.supabase.co/r/CODE` (change `N`). You should see 401 five times, then 429. If you never get a 429 from one source, your host's header layout differs: the per-link cap of 50 still applies, but tell me what headers you see and I will adjust `clientIp()`.
5. **Dependencies:** `npm audit --omit=dev`, then `npm audit fix`, re-run the tests, commit.
