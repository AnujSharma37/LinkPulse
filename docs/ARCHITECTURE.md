# LinkPulse architecture — explained for beginners

## The big picture

LinkPulse has three parts. Each one has a single job.

```
 Browser (React app)  ──JSON over /api──▶  Node.js API (Express)  ──SQL──▶  PostgreSQL
        ▲                                         │
        │                                         │  GET /abc1234  (a visitor opens a short link)
 Visitor's browser ◀────── 302 redirect ──────────┘
```

| Part | Folder | Job |
|---|---|---|
| **Frontend** | `web/` | React + TypeScript pages: landing, login, dashboard, links, analytics, campaigns. It only *displays* data and sends requests. It is never trusted to enforce rules. |
| **Backend** | `server/` | Express + TypeScript. Checks who you are, validates every input, runs safety checks, stores data, and serves short-link redirects. All rules live here. |
| **Database** | `server/migrations/` | PostgreSQL tables for users, sessions, links, clicks, campaigns, tags, safety results and a blocklist. |

In production the Node server also serves the built React files, so everything runs as **one web service** on one domain (no CORS headaches, cookies just work).

There is also a **Supabase variant** in `supabase/` (Supabase Auth + Row Level Security + Edge Functions). See [SUPABASE.md](SUPABASE.md).

## What happens when…

### …you sign up
1. The React form checks the email format and password length (instant feedback only).
2. It sends `POST /api/auth/signup`. The server validates again with **zod**.
3. The password is hashed with **bcrypt** (a slow, salted, one-way function). Only the hash is stored.
4. The server creates a random 32-byte session token, stores its **SHA-256 hash** in `sessions`, and sends the raw token in an **httpOnly** cookie. JavaScript can't read that cookie, so an XSS bug couldn't steal it.

### …you create a short link
1. `POST /api/links` with the destination and options.
2. **URL validation**: must parse as a URL, scheme must be `http` or `https`, no spaces/control characters, ≤ 2048 chars, and not one of our own short links (no loops).
3. **Safety checks** (see below). Blocked → refused (422). Suspicious → you must tick “I understand” (409 until you do).
4. **Short code**: either your custom alias (validated, lower-cased, not reserved) or a random code.
5. Insert into `links`. If the code already exists, Postgres' `UNIQUE` constraint rejects it — for random codes we retry with a new one (up to 5 times); for aliases we tell you it's taken.
6. Link passwords are hashed with bcrypt, exactly like account passwords.

### …a visitor opens `https://your.domain/abc1234`
The server runs these checks **in order**, every single visit:

1. Is `abc1234` a valid code format? → else 404 page
2. Does it exist? → else 404 “doesn't exist”
3. Is it disabled? → 410 “disabled”
4. Is it past its expiry? → 410 “expired”
5. Has it hit its click limit? → 410 “limit reached”
6. Is the destination now on the blocklist? → 403 “blocked”
7. Password-protected? → show the password form; the POST is checked with bcrypt, and brute-force attempts are rate-limited
8. Flagged suspicious? → show a warning page with a “continue” button
9. **Atomically** use one click and record the click event (one transaction)
10. `302` redirect to the destination **stored in the database** (plus the campaign's UTM tags)

Because the redirect target only ever comes from the database, LinkPulse is not an **open redirect** (an attacker can't make it send people to an arbitrary URL by editing a query string).

## Key algorithms

### Random, unique short codes
- Alphabet: `abcdefghijkmnopqrstuvwxyz23456789` (33 symbols — no `l`, `1`, `0`, `o`-vs-`0` confusion; all lower-case so codes are case-insensitive).
- Length 7 → 33⁷ ≈ **42.6 billion** possibilities.
- Each character is picked with `crypto.randomInt`, a cryptographically secure generator with no modulo bias. Codes are therefore unguessable — you can't walk through `aaaaaaa, aaaaaab…` to discover other people's links.
- Uniqueness is guaranteed by the database (`UNIQUE` index), not by hoping. On a collision we retry.

### Click limits that hold under load
The click is consumed with **one SQL statement**:

```sql
UPDATE links SET click_count = click_count + 1
 WHERE id = $1 AND status = 'active'
   AND (expires_at IS NULL OR expires_at > now())
   AND (max_clicks IS NULL OR click_count < max_clicks)
RETURNING id;
```

If 12 people hit a link with a limit of 3 at the same moment, Postgres locks the row and evaluates the `WHERE` one at a time, so exactly 3 updates succeed. Our tests fire 12 concurrent requests and check exactly that. A `CHECK (click_count <= max_clicks)` constraint is a second safety net.

### Safety verdicts (honest labels)
| Label | Meaning |
|---|---|
| **URL format valid** | Structurally fine and passed our heuristics; **no reputation lookup was done** (no threat-intel key configured). |
| **No known issue found** | Heuristics passed *and* Google Safe Browsing found nothing. Still **not a guarantee**. |
| **Suspicious** | A heuristic fired (raw IP host, `user@host` trick, punycode look-alike, odd port, nested shortener, executable download, HTTP login page, risky TLD, very deep subdomains). Visitors see a warning page first. |
| **Blocked** | On the blocklist, matched Safe Browsing, or points to a private/local network address. Link refused. |

The server **never fetches the destination URL**, so there is no SSRF risk. The only outbound call is to Google's fixed API host, and only if you configure a key.

## Database schema

```
users ─┬─< sessions
       ├─< campaigns ─┐
       ├─< tags ──┐   │
       └─< links ─┼───┘ (campaign_id, nullable)
             │    │
             │    └─< link_tags >── (link_id, tag_id)
             ├─< click_events      (one row per real visit)
             └─< safety_checks     (history of verdicts)
blocked_domains                     (operator blocklist)
```

| Table | Important columns | Notes |
|---|---|---|
| `users` | `email` (unique, case-insensitive), `password_hash` | bcrypt |
| `sessions` | `token_hash`, `expires_at` | raw token only lives in the cookie |
| `links` | `code` (unique), `destination_url`, `status`, `expires_at`, `password_hash`, `max_clicks`, `click_count`, `campaign_id`, `safety_status`, `safety_reasons` | `CHECK` constraints mirror app rules |
| `click_events` | `clicked_at`, `referrer_host`, `device_type`, `browser`, `os`, `campaign_id`, `utm_*` | **no IP, no full user-agent, no location** |
| `campaigns` | `name`, `utm_source/medium/campaign` | unique name per user |
| `tags`, `link_tags` | `name`, `color` | many-to-many |
| `safety_checks` | `status`, `reasons`, `providers` | audit trail |
| `blocked_domains` | `domain` | subdomains are blocked too |

Indexes: `links(user_id, created_at)`, `links(campaign_id)`, `click_events(link_id, clicked_at)`, `link_tags(tag_id)`, unique `lower(email)`, unique `(user_id, lower(name))` for campaigns and tags.

**Ownership**: every query for user data includes `WHERE user_id = <logged-in user>`. Asking for someone else's link returns the same 404 as a missing link, so you can't even confirm it exists. (In the Supabase variant the same rule is enforced by Row Level Security policies inside Postgres.)

## Security checklist (what protects what)

| Threat | Defence |
|---|---|
| Stolen passwords | bcrypt hashes (cost 12), generic “incorrect email or password” message, constant-time dummy check for unknown emails |
| Session theft | httpOnly + SameSite=Lax + Secure cookie; only a hash stored server-side; sessions expire |
| CSRF | SameSite cookies **and** an Origin check **and** `Content-Type: application/json` required on API writes |
| XSS | React escapes output; server pages HTML-escape everything; strict Content-Security-Policy |
| Open redirect | Redirect targets come only from the DB; login `?next=` accepts only relative paths |
| `javascript:`/`data:` links | Only `http:`/`https:` accepted, validated server-side |
| SSRF | The server never fetches destinations |
| Brute force | Rate limits on login/signup (20 / 15 min / IP), link unlock (5 failures / 15 min / IP / link), link creation (100 / hour / user), redirects (120 / min / IP), API (300 / min / IP), password-reset and verification emails (3 / address and 10 / IP per hour). Counters live in PostgreSQL (`rate_limits`) so every instance shares them |
| Editing others' data | Ownership in every query; campaign/tag ids checked to belong to you |
| SQL injection | Parameterised queries only; search wildcards escaped |
| Leaking internals | Errors return a generic message; details only in server logs |


## Shared code, redirect speed, account email

**One copy of the rules.** Code needed by both backends (URL/alias validation, safety heuristics, Safe Browsing call, user-agent classifier, HTML pages) lives once in `/shared`. `npm run sync` copies it into `server/src/shared` and `supabase/functions/_shared/core` with a "generated" header; `npm run sync:check` (CI, `npm run typecheck`, and a unit test) fails if a copy was edited by hand or is stale. Each backend keeps only its thin binding (blocklist query, config).

**Fast redirects.** A visit costs: one cached link lookup (5 s TTL, per process), one blocklist query, one rate-limit upsert, and ONE statement that checks every rule, bumps the counter and records the click event. The cache never decides access: that statement re-checks status, expiry, click limit, block state, password hash and destination in the database, and a cached "no" is re-read before it is shown.

**Account email.** Signup sends a confirmation link; `/forgot-password` → `/reset-password` handle resets. Tokens are random, single-use, hashed at rest, and expire. Delivery runs in the background so response timing doesn't reveal which addresses have accounts.

**No account enumeration.** With real email configured, signup answers `202 check your email` for new and existing addresses alike (existing owners get an email instead), login is refused until the address is confirmed, and password reset always answers 200. The SMTP client (`lib/smtp.ts`) is dependency-free and refuses to send credentials before TLS.
