// Integration tests for the Edge Function handlers, run with Deno against a local PostgreSQL database
// prepared by supabase/tests/run.sh (Supabase auth stub + migration). Auth is faked: token "alice" → Alice.
//   deno test -A supabase/functions/tests/functions_test.ts
import postgres from 'npm:postgres@3.4.5';
import nodeAssert from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepStrictEqual(a, b, msg);
const assertMatch = (s: string, re: RegExp) => nodeAssert.match(s, re);
import type { Deps } from '../_shared/deps.ts';
import { createLinkHandler } from '../create-link/handler.ts';
import { updateLinkHandler } from '../update-link/handler.ts';
import { redirectHandler } from '../r/handler.ts';

const sql = postgres(Deno.env.get('TEST_DB_URL') ?? 'postgres://postgres:postgres@localhost:5432/linkpulse_supabase_test', { onnotice: () => {} });
const users: Record<string, string> = { alice: '11111111-1111-1111-1111-111111111111', bob: '22222222-2222-2222-2222-222222222222' };
const deps: Deps = {
  sql,
  getUserId: async (t) => users[t] ?? null,
  env: { appOrigin: 'http://app.test', shortBaseUrl: 'http://short.test/functions/v1/r', blocklist: ['evil.example'] },
};
const create = createLinkHandler(deps);
const update = updateLinkHandler(deps);
const redirect = redirectHandler(deps);

const post = (h: (r: Request) => Promise<Response>, token: string | null, body: unknown) =>
  h(new Request('http://fn.test/', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
const visit = (code: string, init?: RequestInit) => redirect(new Request(`http://short.test/functions/v1/r/${code}`, init));
const form = (o: Record<string, string>) => ({ method: 'POST', body: new URLSearchParams(o), headers: { 'x-forwarded-for': '198.51.100.7' } });

Deno.test({ name: 'edge functions', sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  await t.step('rejects unauthenticated and invalid input', async () => {
    assertEquals((await post(create, null, { destinationUrl: 'https://example.com' })).status, 401);
    assertEquals((await post(create, 'mallory', { destinationUrl: 'https://example.com' })).status, 401);
    for (const bad of ['javascript:alert(1)', 'ftp://x.example', 'nope', 'http://short.test/functions/v1/r/abc']) {
      assertEquals((await post(create, 'alice', { destinationUrl: bad })).status, 400, bad);
    }
    assertEquals((await post(create, 'alice', { destinationUrl: 'https://example.com', alias: 'api' })).status, 400);
  });

  let code = '';
  await t.step('creates a link and redirects with click recorded', async () => {
    const res = await post(create, 'alice', { destinationUrl: 'https://example.com/fn', title: 'Fn' });
    assertEquals(res.status, 201);
    const { link } = await res.json();
    assertMatch(link.code, /^[a-z2-9]{7}$/);
    code = link.code;
    const r = await visit(code, { headers: { referer: 'https://www.reddit.com/r/x', 'user-agent': 'Mozilla/5.0 (iPhone) Mobile Safari' } });
    assertEquals(r.status, 302);
    assertEquals(r.headers.get('location'), 'https://example.com/fn');
    const [ev] = await sql`SELECT e.referrer_host, e.device_type FROM click_events e JOIN links l ON l.id = e.link_id WHERE l.code = ${code}`;
    assertEquals(ev, { referrer_host: 'reddit.com', device_type: 'mobile' });
    assertEquals((await visit('zz-not-there')).status, 404);
    assertEquals((await visit(code, { method: 'HEAD' })).status, 200);
  });

  await t.step('alias conflict, blocklist and suspicious confirmation', async () => {
    assertEquals((await post(create, 'alice', { destinationUrl: 'https://example.com', alias: 'fn-alias' })).status, 201);
    assertEquals((await post(create, 'bob', { destinationUrl: 'https://example.com', alias: 'FN-ALIAS' })).status, 409);
    assertEquals((await post(create, 'alice', { destinationUrl: 'https://sub.evil.example/' })).status, 422);
    assertEquals((await post(create, 'alice', { destinationUrl: 'http://10.0.0.1/' })).status, 422);
    const s = await post(create, 'alice', { destinationUrl: 'http://198.51.100.1:8080/login' });
    assertEquals(s.status, 409);
    const ok = await post(create, 'alice', { destinationUrl: 'http://198.51.100.1:8080/login', acknowledgeWarnings: true });
    assertEquals(ok.status, 201);
    const sc = (await ok.json()).link.code;
    const warn = await visit(sc);
    assertEquals(warn.status, 200);
    assert((await warn.text()).includes('Check before you continue'));
    assertEquals((await visit(sc, form({ confirm: '1' }))).status, 303);
  });

  await t.step('password + click limit + brute-force limit', async () => {
    const { link } = await (await post(create, 'alice', { destinationUrl: 'https://example.com/pw', password: 'hunter22', maxClicks: 1 })).json();
    assertEquals((await visit(link.code)).status, 200);
    assertEquals((await visit(link.code, form({ password: 'nope' }))).status, 401);
    const good = await visit(link.code, form({ password: 'hunter22' }));
    assertEquals(good.status, 303);
    assertEquals(good.headers.get('location'), 'https://example.com/pw');
    assertEquals((await visit(link.code, form({ password: 'hunter22' }))).status, 410);

    const { link: l2 } = await (await post(create, 'alice', { destinationUrl: 'https://example.com/pw2', password: 'correct-horse' })).json();
    for (let i = 0; i < 5; i++) assertEquals((await visit(l2.code, form({ password: `guess${i}` }))).status, 401);
    assertEquals((await visit(l2.code, form({ password: 'correct-horse' }))).status, 429);
  });

  await t.step('update-link enforces ownership and re-checks safety', async () => {
    const [{ id }] = await sql`SELECT id FROM links WHERE code = ${code}`;
    assertEquals((await post(update, 'bob', { id, destinationUrl: 'https://bob.example' })).status, 404);
    assertEquals((await post(update, 'alice', { id, destinationUrl: 'https://evil.example' })).status, 422);
    const ok = await post(update, 'alice', { id, destinationUrl: 'https://example.net/new', password: 'newpass' });
    assertEquals(ok.status, 200);
    assertEquals((await ok.json()).link.has_password, true);
    assertEquals((await visit(code)).status, 200); // now shows the password form
    assertEquals((await post(update, 'alice', { id, password: null })).status, 200);
    assertEquals((await visit(code)).headers.get('location'), 'https://example.net/new');
  });

  await t.step('brute-force limits hold even when the client fakes x-forwarded-for', async () => {
    const { link } = await (await post(create, 'alice', { destinationUrl: 'https://example.com/pw3', password: 'right-pass' })).json();
    const guess = (xff: string, password: string) =>
      visit(link.code, { method: 'POST', body: new URLSearchParams({ password }), headers: { 'x-forwarded-for': xff } });
    // The left-most entry changes every time (client-controlled); the right-most (added by our infrastructure) does not.
    for (let i = 0; i < 5; i++) assertEquals((await guess(`10.0.0.${i}, 203.0.113.9`, `bad${i}`)).status, 401);
    assertEquals((await guess('10.0.1.1, 203.0.113.9', 'right-pass')).status, 429);

    // Per-link cap: many different clients together cannot exceed 50 failures per 15 minutes.
    const { link: l4 } = await (await post(create, 'alice', { destinationUrl: 'https://example.com/pw4', password: 'right-pass' })).json();
    for (let i = 0; i < 50; i++) {
      const r = await visit(l4.code, { method: 'POST', body: new URLSearchParams({ password: `bad${i}` }), headers: { 'x-forwarded-for': `198.18.0.${i}` } });
      assertEquals(r.status, 401);
    }
    const last = await visit(l4.code, { method: 'POST', body: new URLSearchParams({ password: 'right-pass' }), headers: { 'x-forwarded-for': '198.18.1.1' } });
    assertEquals(last.status, 429);
  });

  await t.step('malformed short codes get a 404 page, not a crash', async () => {
    assertEquals((await visit('%E0%A4%A')).status, 404);
  });

  await t.step('update-link is rate limited per user', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 70; i++) statuses.push((await post(update, 'alice', {})).status);
    assert(statuses.includes(429), 'expected a 429 within 70 calls');
    assertEquals(statuses[0], 400);
  });

  await sql.end();
} });
