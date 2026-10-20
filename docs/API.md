# LinkPulse API (Node variant)

Base URL: `/api` on the same origin as the web app. All bodies are JSON.

- **Auth**: an httpOnly `lp_session` cookie set by signup/login. Send requests with `credentials: 'same-origin'`.
- **Writes** (`POST`/`PATCH`/`DELETE`) must come from the app's origin and use `Content-Type: application/json` (CSRF protection).
- **Errors** always look like:

```json
{ "error": { "code": "validation_error", "message": "Human-readable message", "details": [{ "field": "alias", "message": "…" }] } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `validation_error`, `bad_request`, `bad_json` | Invalid input |
| 401 | `unauthorized`, `invalid_credentials` | Not logged in / wrong login |
| 403 | `forbidden_origin` | Cross-site write |
| 404 | `not_found` | Missing **or not yours** |
| 409 | `conflict` | Email/alias/campaign/tag name taken |
| 409 | `safety_confirmation_required` | Suspicious URL: resend with `acknowledgeWarnings: true` (`details.safety` has the reasons) |
| 415 | `unsupported_media_type` | Write without JSON content type |
| 422 | `unprocessable` | Destination blocked (`details.safety`) |
| 429 | `rate_limited` | Too many requests |
| 500 | `internal` | Unexpected (details only in server logs) |

## Health & config

| Method | Path | Response |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` (also checks the DB) |
| GET | `/api/config` | `{ shortBaseUrl, threatIntelEnabled }` |

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/signup` | `{ email, password, displayName? }` — password 8–128 chars with a letter and a digit | `201 { user }` + cookie. In private-sign-up mode: always `202 { pending: true }` with no cookie, for new and existing addresses alike |
| POST | `/api/auth/login` | `{ email, password }` | `200 { user }` + cookie; in private-sign-up mode `403 email_not_verified` (and a fresh link is emailed) until confirmed |
| POST | `/api/auth/logout` | `{}` | `{ ok: true }`, cookie cleared, session deleted |
| GET | `/api/auth/me` | — | `{ user }` or 401 |

| POST | `/api/auth/verify-email` | `{ token }` from the confirmation email | `200 { ok }` or `400 invalid_token` |
| POST | `/api/auth/resend-verification` | `{}` (logged in) | `200 { ok }` / `{ ok, alreadyVerified }`; limited to 3 per address per hour |
| POST | `/api/auth/forgot-password` | `{ email }` | Always `200 { ok }`, whether or not the account exists; limited to 3 per address and 10 per IP per hour |
| POST | `/api/auth/reset-password` | `{ token, password }` | `200 { ok }`; revokes every session; `400 invalid_token` if expired/used |

`user = { id, email, displayName, createdAt, emailVerified }`

Tokens are single-use, stored only as SHA-256 hashes, valid 24 h (verification) / 60 min (reset), and a newer link retires the older one. When `REQUIRE_EMAIL_VERIFICATION` is on, `POST /api/links` returns `403 email_not_verified` until the address is confirmed. `GET /api/config` reports `emailVerificationRequired`.

## Links

`Link` object:

```json
{
  "id": "uuid", "code": "k7m2xqa", "shortUrl": "https://lp.example/k7m2xqa",
  "destinationUrl": "https://example.com/", "title": "Docs", "isCustomAlias": false,
  "status": "active", "effectiveStatus": "active | disabled | expired | limit_reached | blocked",
  "expiresAt": null, "hasPassword": false, "maxClicks": null, "clickCount": 0,
  "campaign": { "id": "uuid", "name": "Posters" }, "tags": [{ "id": "uuid", "name": "print", "color": "#6366f1" }],
  "safety": { "status": "format_valid", "reasons": [{ "code": "…", "severity": "info|warning|block", "message": "…" }], "checkedAt": "…" },
  "lastClickedAt": null, "createdAt": "…", "updatedAt": "…"
}
```

The password hash is never returned — only `hasPassword`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/links` | Query: `search`, `status` (`all/active/disabled/expired/limit_reached/blocked`), `safety`, `campaignId`, `tagId`, `sort` (`newest/oldest/most_clicks`), `page`, `pageSize` (≤100). → `{ links, total, page, pageSize }` |
| POST | `/api/links` | Body: `destinationUrl` (required), `alias?`, `title?`, `expiresAt?` (ISO, future), `password?` (4–128), `maxClicks?` (≥1), `campaignId?`, `tagIds?`, `acknowledgeWarnings?`. → `201 { link }` |
| GET | `/api/links/:id` | → `{ link }` |
| PATCH | `/api/links/:id` | Any of: `destinationUrl` (re-runs safety), `title`, `status` (`active/disabled`), `expiresAt` (`null` clears), `password` (string sets, `null` removes), `maxClicks` (`null` = unlimited; can't go below `clickCount`), `campaignId`, `tagIds`, `acknowledgeWarnings`. Alias can't change. |
| DELETE | `/api/links/:id` | `204`. Deletes its click history too. |
| POST | `/api/links/:id/recheck-safety` | `{ link, safety }` |
| POST | `/api/safety/check` | `{ url }` → `{ url, safety }` preview (nothing stored) |

`safety` result: `{ status, reasons, providers, threatIntel: 'checked' | 'not_configured' | 'error' }`.

## Analytics

All numbers are computed from `click_events`. Query: `days` (1–365, default 30), `tz` (IANA zone; unknown zones fall back to UTC — see `range.tz`).

| Method | Path | Response |
|---|---|---|
| GET | `/api/analytics/overview` | `{ range, links: { total, active, suspicious }, totals: { allTimeClicks, clicksInRange, botClicksInRange, lastClickAt }, daily: [{ date, clicks, human_clicks }], devices, referrers, browsers, operatingSystems, topLinks, campaigns, unavailable }` |
| GET | `/api/analytics/links/:id` | Same breakdowns for one link + `recentClicks` (last 10) |

Breakdown items are `{ label, clicks }`. `unavailable` explains the metrics we deliberately do not collect (location, unique visitors).

## Campaigns & tags

| Method | Path | Body |
|---|---|---|
| GET | `/api/campaigns` | → `{ campaigns: [{ id, name, description, utmSource, utmMedium, utmCampaign, linkCount, totalClicks }] }` |
| POST | `/api/campaigns` | `{ name, description?, utmSource?, utmMedium?, utmCampaign? }` |
| PATCH | `/api/campaigns/:id` | any of the above |
| DELETE | `/api/campaigns/:id` | links keep existing, their campaign is cleared |
| GET | `/api/tags` | → `{ tags: [{ id, name, color, linkCount }] }` |
| POST | `/api/tags` | `{ name, color? }` (`#rrggbb`) |
| PATCH | `/api/tags/:id` | `{ name?, color? }` |
| DELETE | `/api/tags/:id` | |

When a link belongs to a campaign with UTM values, the redirect appends `utm_source/utm_medium/utm_campaign` — but never overwrites UTM values already in the destination URL.

## Public short-link routes (not under /api)

| Method | Path | Behaviour |
|---|---|---|
| GET | `/:code` | 302 to destination, or an HTML page: password form (200), suspicious warning (200), not found (404), disabled/expired/limit reached (410), blocked (403). `Cache-Control: no-store`. |
| HEAD | `/:code` | Same checks, **does not** consume a click (link previews, uptime checkers) |
| POST | `/:code` | Form fields `password` and/or `confirm=1`. Wrong password → 401 page. 5 failed attempts per IP per link per 15 min → 429. Success → 303 to destination. |

Codes are case-insensitive.

## Supabase variant endpoints

See [SUPABASE.md](SUPABASE.md): `create-link`, `update-link` (same request/response contract as `POST /api/links` / the sensitive fields of `PATCH`) and the public `r/<code>` redirect function.
