/**
 * The redirect cache must make redirects faster WITHOUT ever serving a change late where it matters:
 * disabled links, click limits, passwords and destinations are all re-checked in the database.
 * The other test files run with the cache off; here it is switched on.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../src/db.js';
import { linkCache } from '../src/lib/linkCache.js';
import { app, createLink, newUser, resetDb } from './helpers.js';

beforeAll(async () => { await resetDb(); linkCache.ttlMs = 5000; });
afterAll(async () => { linkCache.ttlMs = 0; linkCache.clear(); await pool.end(); });
beforeEach(() => linkCache.clear());

const visit = (code: string) => request(app).get(`/${code}`);
const clicks = async (id: string) => Number((await pool.query('SELECT click_count FROM links WHERE id = $1', [id])).rows[0].click_count);

async function makeLink(extra: Record<string, unknown> = {}) {
  const { agent } = await newUser();
  const res = await createLink(agent, { destinationUrl: 'https://example.com/first', ...extra });
  expect(res.status).toBe(201);
  return { agent, link: res.body.link as { id: string; code: string } };
}

describe('redirect cache', () => {
  it('reads the link from the database once, then serves it from memory', async () => {
    const { link } = await makeLink();
    const spy = vi.spyOn(pool, 'query');
    try {
      expect((await visit(link.code)).status).toBe(302);
      expect((await visit(link.code)).status).toBe(302);
      expect((await visit(link.code)).status).toBe(302);
      const linkReads = spy.mock.calls.filter(([sql]) => String(typeof sql === 'string' ? sql : (sql as { text?: string })?.text).includes('LEFT JOIN campaigns')).length;
      expect(linkReads).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(await clicks(link.id)).toBe(3); // every visit still counts
  });

  it('a link disabled behind the cache’s back is never served', async () => {
    const { link } = await makeLink();
    expect((await visit(link.code)).status).toBe(302); // now cached as active
    await pool.query("UPDATE links SET status = 'disabled' WHERE id = $1", [link.id]);
    const res = await visit(link.code);
    expect(res.status).toBe(410);
    expect(await clicks(link.id)).toBe(1);
  });

  it('click limits hold, and raising the limit takes effect at once', async () => {
    const { link } = await makeLink({ maxClicks: 1 });
    expect((await visit(link.code)).status).toBe(302);
    expect((await visit(link.code)).status).toBe(410); // limit reached (a cached "no" is re-checked, then cached)
    await pool.query('UPDATE links SET max_clicks = 5 WHERE id = $1', [link.id]);
    expect((await visit(link.code)).status).toBe(302);  // not stuck on the stale "limit reached"
    expect(await clicks(link.id)).toBe(2);
  });

  it('a password added behind the cache’s back is enforced before any redirect', async () => {
    const { link } = await makeLink();
    expect((await visit(link.code)).status).toBe(302); // cached without a password
    await pool.query("UPDATE links SET password_hash = '$2a$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234' WHERE id = $1", [link.id]);
    const retry = await visit(link.code);
    expect(retry.status).toBe(303);                    // refused the stale row and started over…
    expect(retry.headers.location).toBe(`/${link.code}`);
    const page = await visit(link.code);
    expect(page.status).toBe(200);                     // …and now asks for the password
    expect(page.text).toContain('password');
    expect(await clicks(link.id)).toBe(1);             // neither of those visits used a click
  });

  it('a changed destination is never served from a stale row', async () => {
    const { link } = await makeLink();
    expect((await visit(link.code)).headers.location).toBe('https://example.com/first');
    await pool.query("UPDATE links SET destination_url = 'https://example.com/second' WHERE id = $1", [link.id]);
    expect((await visit(link.code)).status).toBe(303);
    expect((await visit(link.code)).headers.location).toBe('https://example.com/second');
  });

  it('edits made through the API are visible immediately (the cache is invalidated)', async () => {
    const { agent, link } = await makeLink();
    expect((await visit(link.code)).headers.location).toBe('https://example.com/first');
    expect((await agent.patch(`/api/links/${link.id}`).send({ destinationUrl: 'https://example.com/edited' })).status).toBe(200);
    expect((await visit(link.code)).headers.location).toBe('https://example.com/edited');
    expect((await agent.patch(`/api/links/${link.id}`).send({ status: 'disabled' })).status).toBe(200);
    expect((await visit(link.code)).status).toBe(410);
    expect((await agent.delete(`/api/links/${link.id}`)).status).toBe(204);
    expect((await visit(link.code)).status).toBe(404);
  });

  it('the blocklist is still checked on every visit, even for a cached link', async () => {
    const { link } = await makeLink({ destinationUrl: 'https://later-blocked.example/x' });
    expect((await visit(link.code)).status).toBe(302);
    await pool.query("INSERT INTO blocked_domains (domain) VALUES ('later-blocked.example')");
    expect((await visit(link.code)).status).toBe(403);
  });

  it('concurrent visitors still can’t exceed a click limit', async () => {
    const { link } = await makeLink({ maxClicks: 3 });
    await visit(link.code).then(() => clicks(link.id)); // warm the cache
    await pool.query('UPDATE links SET click_count = 0 WHERE id = $1', [link.id]);
    const statuses = (await Promise.all(Array.from({ length: 12 }, () => visit(link.code)))).map((r) => r.status);
    expect(statuses.filter((s) => s === 302)).toHaveLength(3);
    expect(await clicks(link.id)).toBe(3);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM click_events WHERE link_id = $1', [link.id]);
    expect(rows[0].n).toBe(4); // 1 warm-up click (before the reset) + exactly 3 allowed
  });
});
