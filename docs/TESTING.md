# Testing, feature checklist & known limitations

## Automated tests

| Command | What it runs | Needs |
|---|---|---|
| `npm run typecheck` | TypeScript for server + web | — |
| `npm test` | 35 server tests (vitest + supertest) against a **real** Postgres DB `linkpulse_test` — integration tests for journeys 1–9 plus unit tests | Postgres |
| `./supabase/tests/run.sh` | Supabase migration, RLS tests (SQL) and Edge Function tests (Deno) | Postgres, Deno (optional) |
| `npm run e2e` | Playwright browser tests, **desktop (1366×900) and mobile (Pixel 7)** | Running production build on :4000 |

Results from the last full run (18 Oct 2026):

- `npm test`: **35/35 passed**
- `supabase/tests/run.sh`: **all SQL assertions passed; Deno 5/5 steps passed**
- `npm run e2e`: **4/4 passed** (2 tests × 2 viewports)

## Feature checklist

✅ = implemented **and** covered by an automated test. ☑️ = implemented but not covered by an automated test (verify with the manual cases below). ⚠️ = partial / needs your setup.

| Feature | Status | Evidence |
|---|---|---|
| Sign-up, login, logout, session cookie | ✅ | `journeys.test.ts` J1, e2e |
| Passwords hashed (bcrypt), generic login errors | ✅ | J1 |
| Create link: destination, custom alias, expiry, password, click limit | ✅ | J2–J8, e2e |
| HTTP/HTTPS-only validation (server-side) | ✅ | `only accepts http/https`, unit tests |
| Secure random short codes, collision retry | ✅ | unit test (20k unique), code in `links.ts` |
| Alias collision + invalid/reserved alias checks | ✅ | `supports custom aliases…` |
| Persists and appears in My Links after refresh | ✅ | J3, e2e reload |
| Real redirect from DB | ✅ | J4, e2e |
| 404 / disabled / expired / limit / blocked pages | ✅ | J6, J8, e2e |
| Password-protected links (reject wrong, accept right) | ✅ | J7, e2e |
| Brute-force limit on link passwords | ✅ | J7 rate-limit test |
| Click limits enforced under concurrency | ✅ | J8 (12 concurrent requests, limit 3 → exactly 3) |
| Ownership: can't view/edit/delete others' links, campaigns, tags | ✅ | J9 (API) + e2e (UI) |
| CSRF (cross-origin writes rejected) | ✅ | J1 |
| My Links search, status/campaign/tag filters, sort, pagination | ✅ (search/filters) ☑️ (pagination) | campaigns test |
| Copy, edit, disable/enable actions | ✅ | e2e (disable/enable), J6 (edit via API) ☑️ copy |
| Click events recorded; analytics from saved events | ✅ | J5, e2e |
| Charts (clicks per day), breakdowns (referrer, device, browser, OS, campaign) | ✅ | J5, e2e screenshots |
| Unavailable metrics labelled (location, unique visitors) | ✅ | J5 |
| Campaigns with UTM auto-append, tags | ✅ | campaigns test, e2e |
| QR code generation (PNG/SVG, in-browser) | ✅ (renders) ☑️ (download) | e2e |
| Safety: format, heuristics, blocklist (env + DB), private network | ✅ | Safety tests, unit tests |
| Safety labels: format valid / no known issue / suspicious / blocked | ✅ | Safety tests |
| Suspicious → owner confirmation + visitor warning page | ✅ | Safety tests, e2e |
| Blocklist re-checked at redirect time | ✅ | `re-checks the blocklist at redirect time` |
| Google Safe Browsing integration | ⚠️ | Implemented; **not tested against the live Google API** (needs your key). Without a key, status is never “no known issue”. |
| Rate limiting (auth, create, redirect, API, unlock) | ✅ (unlock) ☑️ (others) | J7 |
| Responsive mobile & desktop | ✅ | e2e on both viewports asserts no horizontal scroll on every page |
| Loading, empty, error states | ☑️ | visual check |
| Supabase variant (RLS, functions) | ✅ (local) ⚠️ (live) | `supabase/tests`, see SUPABASE.md |
| Hosted demo | ⚠️ | Not deployed from this environment — see README “Deploy for free” |

## Manual test cases

Run `npm run dev`, open http://localhost:5173. Use a second browser (or a private window) as the “visitor”.

| # | Steps | Expected |
|---|---|---|
| M1 | Sign up with `bad-email` / `short` | Inline errors for both fields; nothing sent |
| M2 | Sign up with a valid email + `hackathon26` | Lands on Dashboard “Welcome back”, empty-state card |
| M3 | Sign up again with the same email (another window) | “An account with this email already exists” |
| M4 | Log out, log in with wrong password | “Incorrect email or password.” (same for unknown email) |
| M5 | Create link to `https://example.com`, no alias | Success card with short URL, “URL format valid”, QR code |
| M6 | Create with alias `My-Event` then again with `my-event` | First works (stored as `my-event`), second: “already taken” |
| M7 | Alias `api`, `ab`, `has space` | Validation message each time |
| M8 | Destination `javascript:alert(1)`, `ftp://x.com`, `example.com` | “Only http:// and https://…” / “Enter a full URL…” |
| M9 | Destination `http://localhost:3000` | Blocked message, link not created |
| M10 | Destination `http://203.0.113.9:8080/login` | Suspicious warnings, button disabled until the checkbox is ticked |
| M11 | Visitor opens the M10 link | “Check before you continue” page → continue → destination |
| M12 | Refresh My Links | All links still listed |
| M13 | Visitor opens the M5 link | Arrives at example.com |
| M14 | Open link details | Clicks used = 1, chart shows today, device/referrer bars |
| M15 | Disable M5 link, visitor opens it | “This link has been disabled” (410) |
| M16 | Re-enable, edit expiry to 2 minutes from now, wait, visit | “This link has expired” |
| M17 | Create link with password `letmein` + click limit 1; visitor enters `wrong` | “Incorrect password” |
| M18 | Visitor enters `letmein` | Redirects; second visit shows “click limit reached” |
| M19 | Enter 5 wrong passwords on another protected link | 6th attempt: “Too many attempts” (429) |
| M20 | User B pastes `/links/<A's link id>` | “Link not found”; API PATCH returns 404 |
| M21 | Create campaign with `utm_source=poster`, assign a link, visit it | Destination URL gets `?utm_source=poster`; campaign shows 1 click |
| M22 | Create a tag, assign it, filter My Links by it | Only tagged links shown |
| M23 | Download QR PNG, scan with a phone | Opens the short link; counts as a click |
| M24 | Resize to 360px wide / use a phone | Menu button opens navigation; no sideways scrolling; all actions reachable |
| M25 | Stop the API while the app is open, click Retry on any page | Clear “Could not reach the LinkPulse server” error |

## Added in the hardening pass

| Area | Tests |
|---|---|
| Shared code, one copy for both backends | `test/shared.test.ts` (includes a drift check that fails if `server/src/shared` or `supabase/functions/_shared/core` differ from `/shared`; fix with `npm run sync`) |
| Safe Browsing request/response handling | `test/shared.test.ts` (stand-in `fetch`: match, clean, HTTP error, timeout, network error, bad JSON) |
| Shared rate limits | `test/ratelimit-store.test.ts` (real Postgres: two store objects share counters, 25 concurrent increments lose none, window reset, purge) |
| Email verification + password reset | `test/auth-email.test.ts` (single-use, expiry, superseded links, hashed storage, no account enumeration, sessions revoked, weak password doesn't burn the link, per-address email limit, optional enforcement) |
| SMTP client | `test/smtp.test.ts` (fake server: envelope, AUTH, refuses credentials without TLS, header-injection and dot-stuffing, UTF-8, STARTTLS, implicit TLS, certificate verification) |
| Private sign-up | `test/auth-email.test.ts` (identical response for new and existing addresses, no session, owner notified, login blocked until confirmed) |
| Redirect cache | `test/ttlCache.test.ts`, `test/redirect-cache.test.ts` (one DB read for repeated visits; disabled/limit/password/destination changes behind the cache are still enforced) |

## Known limitations

- **Rate limits** are stored in PostgreSQL by default, so they hold across several server instances (`RATE_LIMIT_STORE=memory` opts out). Cost: one small query per rate-limited request. Redis would be faster at very high traffic.
- **Email** needs a real provider in production: `EMAIL_PROVIDER=resend` (HTTPS API) or `smtp` (any server; built-in dependency-free client, TLS required before credentials are sent). With the default `console` provider nothing is delivered in production. The SMTP client is tested against an in-process fake server, including STARTTLS and implicit TLS with a self-signed certificate, but not against a real provider (Gmail, Brevo…); it sends one message per connection, which is fine for account email but not for bulk mail.
- **Private sign-up** (default when a real provider is configured): signup, login and password reset don't reveal which addresses are registered. With it off (development default) signup still answers 409 for an existing address, because that is friendlier when there is no email to fall back on.
- **Redirect cache**: link rows are cached in each process for `LINK_CACHE_TTL_MS` (5 s). Click limits, disabled/blocked state, expiry, passwords and destinations are re-checked atomically in the database on every click, so staleness can't grant access; only cosmetic fields (e.g. UTM tags edited on another instance) may lag up to the TTL.
- **Safe Browsing**: the request/response handling is unit-tested with a stand-in `fetch` (`test/shared.test.ts`), but it has never been run against Google's live API here; heuristics can produce false positives (e.g. legitimate IP-address hosts) and false negatives. Labels are worded accordingly.
- **Bots/previews count as clicks** (and toward click limits) so limits stay consistent and can't be bypassed by faking a bot user-agent. They are shown separately as “bot / preview clicks”. `HEAD` requests don't count.
- Device/browser detection is a simple user-agent classifier; some apps report generic agents.
- **Referrer** data is often missing (apps, QR scans, `noreferrer` policies) → “Direct / unknown”.
- No visitor location or unique-visitor counts by design (privacy).
- Session cookies use `SameSite=Lax`; the app must be served from one site (as configured). A separate frontend domain would need CORS + `SameSite=None` changes.
- Aliases can't be renamed after creation (keeps printed QR codes valid).
- The landing page shows an **illustration** of the create form (clearly labelled), not real data.
- Supabase variant: see the limitations list in [SUPABASE.md](SUPABASE.md).
