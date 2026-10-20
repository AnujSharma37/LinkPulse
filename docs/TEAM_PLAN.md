# Team plan — five work areas

Everything lives in one repository and builds into one app. Each area **owns** some files (reviews every change to them) and **depends on** contracts from others. Contracts are the API in [API.md](API.md) and the schema in `server/migrations/`.

## Phases & dependencies

```
Phase 1 (core)   DB+Auth (3) ──▶ Backend+Redirects (2) ──▶ Frontend core (1) ──▶ Integration tests (5)
Phase 2          Safety+Analytics (4) — needs links + click_events from phase 1
Phase 3          QR, campaigns, tags, polish (1, 2, 4) ──▶ E2E, deploy, docs (5)
```

Rule: **don't start phase 2 until journeys 1–4 and 6 pass** (`npm test`).

---

## Area 1 — Frontend & UI/UX

**Owns**: `web/**` (pages, components, `styles.css`, `api.ts` client)
**Depends on**: API contract (Area 2/4), `/api/config`

| # | Task | Depends on | Done when |
|---|---|---|---|
| 1.1 | Design tokens, layout shell, responsive nav | — | No horizontal scroll at 360px; keyboard focus visible |
| 1.2 | Landing, signup, login pages with client validation | 3.2 | Errors shown inline; server errors displayed |
| 1.3 | Create-link form (alias, expiry, password, limit) | 2.2 | Suspicious → confirmation checkbox; blocked → message |
| 1.4 | My Links: search, filters, copy, edit, disable, pagination | 2.3 | Filters persist in URL; empty states |
| 1.5 | Link detail + charts | 4.3 | Real data only; “no clicks yet” state |
| 1.6 | Campaigns & tags pages, QR modal | 2.5, 4.4 | PNG/SVG download works |

## Area 2 — Backend & redirects

**Owns**: `server/src/routes/{links,redirect,campaigns,tags}.ts`, `server/src/lib/{shortcode,url}.ts`, `server/src/views/`, `server/src/app.ts`
**Depends on**: schema (3.1), auth middleware (3.3)

| # | Task | Done when |
|---|---|---|
| 2.1 | Express app, error handler, CSP/helmet, rate limiters | Unknown errors → generic 500, no stack traces |
| 2.2 | `POST /api/links` with URL validation, alias rules, random code + retry | Unit + integration tests green |
| 2.3 | List/search/filter/get/patch/delete with ownership checks | Journey 9 test passes |
| 2.4 | `GET/HEAD/POST /:code` redirect pipeline + error pages | Journeys 4, 6, 7, 8 pass incl. 12-way concurrency test |
| 2.5 | Campaigns/tags CRUD + UTM append at redirect | UTM test passes |

**API contract owned**: everything under `/api/links`, `/api/campaigns`, `/api/tags`, `/:code`.

## Area 3 — Database & authentication

**Owns**: `server/migrations/**`, `server/src/{db,migrate}.ts`, `server/src/lib/auth.ts`, `server/src/middleware/auth.ts`, `server/src/routes/auth.ts`, `supabase/migrations/**`, `supabase/tests/**`
**Depends on**: nothing (first!)

| # | Task | Done when |
|---|---|---|
| 3.1 | Schema migration 001 with constraints & indexes | `npm run migrate` on empty DB succeeds |
| 3.2 | Signup/login/logout/me, bcrypt, session cookie | Journey 1 test passes; hashes only in DB |
| 3.3 | `requireAuth`, `uid(req)` helpers for other areas | Used by every protected router |
| 3.4 | Supabase variant: RLS policies + SQL functions | `supabase/tests/run.sh` passes |

**Rule**: schema changes go in a **new** numbered file (`002_…sql`); never edit an applied migration.

## Area 4 — Safety & analytics

**Owns**: `server/src/lib/{safety,ua}.ts`, `server/src/routes/{analytics,safety}.ts`, `supabase/functions/_shared/safety.ts`
**Depends on**: 2.2 (create flow calls `checkUrlSafety`), 2.4 (redirect writes `click_events`)

| # | Task | Done when |
|---|---|---|
| 4.1 | Heuristics + blocklist + private-network blocking | Unit tests for each rule |
| 4.2 | Optional Google Safe Browsing (env key, 3 s timeout, fail-open with an *info* note) | Without key, status is never “no known issue” |
| 4.3 | Analytics endpoints (daily, devices, referrers, browsers, OS, top links, campaigns) | Numbers equal raw `click_events` counts |
| 4.4 | Privacy review: no IPs/locations stored, `unavailable` labels | Reviewed by Area 5 |

**API contract owned**: `/api/analytics/*`, `/api/safety/check`, `safety` objects.

## Area 5 — Integration, testing, deployment & docs

**Owns**: `server/test/**`, `e2e/**`, `playwright.config.ts`, `.github/workflows/**`, `render.yaml`, `docs/**`, `README.md`, `.env.example`
**Depends on**: all

| # | Task | Done when |
|---|---|---|
| 5.1 | Integration tests for journeys 1–9 against real Postgres | `npm test` green in CI |
| 5.2 | Playwright e2e on desktop + mobile viewports (journey 10) | `npm run e2e` green |
| 5.3 | CI workflow (typecheck, tests, Supabase tests, build, e2e) | Green on main |
| 5.4 | Deploy to a free host, smoke-test all journeys on the live URL | Live link in README |
| 5.5 | Docs: setup, API, testing, limitations | A new teammate can run it from README alone |

## Working agreement

- Branch per task (`area2/redirect-pipeline`), PR reviewed by the file owner.
- Never commit `.env` or keys. Use `.env.example` for new variables.
- A feature is “done” only when its test is written and passing.
- Changing an API response? Update `docs/API.md` and `web/src/api.ts` in the same PR.
