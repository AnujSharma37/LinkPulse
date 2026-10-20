# Supabase variant

There are two ways to use Supabase with LinkPulse.

## Option A (recommended): Node API + Supabase Postgres

Use Supabase only as the free hosted PostgreSQL database. The full app (React UI + Node API) works unchanged.

1. Create a Supabase project → **Project Settings → Database → Connection string → URI** (use the *session pooler* string if your host has no IPv6).
2. Set `DATABASE_URL=<that URI>` and `DATABASE_SSL=true` for the Node server.
3. `npm run migrate` (or let production start-up run it).

Everything in the main README then applies. This is the path the tests cover end to end, including the UI.

## Option B: Supabase-native backend (Auth + RLS + Edge Functions)

`supabase/` contains a backend that replaces the Node API with Supabase services:

| Piece | File | What it does |
|---|---|---|
| Schema + RLS | `supabase/migrations/20261018000000_linkpulse.sql` | Same tables as the Node schema, keyed to `auth.users`. RLS on every table. Clients can read their own rows, update only safe columns (title, status, expiry, limit, campaign), and can never read `password_hash` or write `click_count`/`click_events`. |
| `lp_create_link` | same file | Generates the random code (rejection-sampled, unbiased), retries on collision, hashes the password with bcrypt (`pgcrypto`). Service role only. |
| `lp_resolve_link` | same file | The whole redirect rule pipeline + **atomic** click consumption in one SQL call. Service role only. |
| `lp_rate_limit_*` | same file | DB-backed rate limiter (Edge Function isolates don't share memory). Stores hashed keys only. |
| `create-link` | `supabase/functions/create-link/` | Auth via the user's JWT, input validation, safety checks, calls `lp_create_link`. |
| `update-link` | `supabase/functions/update-link/` | Changes destination (re-checks safety) or password. |
| `r` | `supabase/functions/r/` | Public redirect: `GET/HEAD/POST /functions/v1/r/<code>`; password form, warning page, error pages. |

### Deploy

```bash
npm i -g supabase            # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push                                   # applies the migration
supabase secrets set APP_ORIGIN=https://your-frontend.example \
  SHORT_BASE_URL=https://<ref>.supabase.co/functions/v1/r \
  BLOCKLIST_DOMAINS= GOOGLE_SAFE_BROWSING_API_KEY=
supabase functions deploy create-link
supabase functions deploy update-link
supabase functions deploy r --no-verify-jwt        # public endpoint
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_DB_URL` are injected into Edge Functions by Supabase automatically. The service-role key and DB URL never reach the browser.

### Calling it from a frontend

```ts
const { data, error } = await supabase.functions.invoke('create-link', { body: { destinationUrl, alias } });
const { data: links } = await supabase.from('links').select('*, link_tags(tag_id)').order('created_at', { ascending: false });
await supabase.from('links').update({ status: 'disabled' }).eq('id', id);      // RLS-protected
const { data: events } = await supabase.from('click_events').select('clicked_at, device_type, referrer_host').eq('link_id', id);
```

### What's tested

`./supabase/tests/run.sh` runs on plain local PostgreSQL with a tiny stand-in for Supabase's `auth` schema and roles (`supabase/tests/auth_stub.sql`, which mimics Supabase's default table grants so the REVOKEs are exercised):

- **SQL/RLS tests** (`rls_test.sql`): profiles trigger, code format, alias conflicts, bcrypt storage, password/expiry/disabled/limit/blocklist outcomes, HEAD not consuming clicks, Alice vs Bob isolation on every table, `anon` access, column-level protections, privileged functions not callable by clients.
- **Edge Function tests** (`functions/tests/functions_test.ts`, Deno): the real handlers against that database — auth required, validation, create → redirect → click recorded, alias conflict, blocklist & private-network refusal, suspicious confirmation, password + limit, brute-force limit (429 after 5 failures), update-link ownership and safety re-check.

### Honest limitations of Option B

- **Not wired to the React UI.** The included frontend talks to the Node API. Pointing it at Supabase needs a data-layer adapter in `web/src/api.ts` (Supabase Auth for login, `supabase.from(...)` for lists, the functions above for writes) — not built yet.
- **Not tested against a live Supabase project** from this environment. Supabase Auth's real JWT verification (`supabase.auth.getUser`) is replaced by a fake in the Deno tests.
- **HTML on the default domain**: Supabase may serve `text/html` responses from `*.supabase.co/functions/v1/...` as plain text. Plain redirects (302) are unaffected, but the password/warning/error pages need a custom domain (or a frontend page that posts to the function). Check Supabase's current Edge Functions docs before relying on it.
- Analytics aggregation queries are not provided as SQL views/RPCs yet (only `lp_daily_clicks`); the client can aggregate `click_events` rows it is allowed to read.


Note: Option B uses Supabase Auth, which already provides email confirmation and password reset (configure them in the Supabase dashboard). The validation and safety rules are the same shared code as the Node API (`supabase/functions/_shared/core`, generated from `/shared`).
