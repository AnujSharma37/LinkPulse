/** The Postgres-backed rate-limit store, against a real database. */
import type { Options } from 'express-rate-limit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { PgRateLimitStore, purgeExpiredRateLimits } from '../src/lib/pgRateLimitStore.js';
import { resetDb } from './helpers.js';

beforeAll(resetDb);
afterAll(() => pool.end());

const store = (name: string, windowMs = 60_000) => { const s = new PgRateLimitStore(name); s.init({ windowMs } as Options); return s; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('PgRateLimitStore', () => {
  it('counts hits per key and keeps limiters apart', async () => {
    const a = store('limiter-a'); const b = store('limiter-b');
    expect((await a.increment('1.2.3.4')).totalHits).toBe(1);
    expect((await a.increment('1.2.3.4')).totalHits).toBe(2);
    expect((await a.increment('5.6.7.8')).totalHits).toBe(1);
    expect((await b.increment('1.2.3.4')).totalHits).toBe(1);
  });

  it('is shared between server instances (two store objects = two servers)', async () => {
    const server1 = store('shared'); const server2 = store('shared');
    expect((await server1.increment('ip')).totalHits).toBe(1);
    expect((await server2.increment('ip')).totalHits).toBe(2);
    expect((await server1.increment('ip')).totalHits).toBe(3);
  });

  it('never loses updates under concurrency', async () => {
    const s = store('concurrent');
    const results = await Promise.all(Array.from({ length: 25 }, () => s.increment('ip')));
    expect(results.map((r) => r.totalHits).sort((x, y) => x - y)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('starts a new window once the old one ends', async () => {
    const s = store('window', 300);
    await s.increment('ip'); expect((await s.increment('ip')).totalHits).toBe(2);
    await sleep(450);
    expect(await s.get('ip')).toBeUndefined();
    expect((await s.increment('ip')).totalHits).toBe(1);
  });

  it('decrement, resetKey and resetAll', async () => {
    const s = store('adjust');
    await s.increment('x'); await s.increment('x'); await s.increment('y');
    await s.decrement('x'); expect((await s.get('x'))?.totalHits).toBe(1);
    await s.decrement('x'); await s.decrement('x'); expect((await s.get('x'))?.totalHits).toBe(0); // never negative
    await s.resetKey('y'); expect(await s.get('y')).toBeUndefined();
    await s.increment('z'); await s.resetAll(); expect(await s.get('z')).toBeUndefined();
  });

  it('purges expired counters', async () => {
    const s = store('purge', 60_000);
    await s.increment('old');
    await pool.query("UPDATE rate_limits SET reset_at = now() - interval '5 minutes' WHERE key = 'purge:old'");
    expect(await purgeExpiredRateLimits()).toBeGreaterThanOrEqual(1);
    expect((await pool.query("SELECT 1 FROM rate_limits WHERE key = 'purge:old'")).rowCount).toBe(0);
  });
});
