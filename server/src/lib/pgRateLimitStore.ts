import type { ClientRateLimitInfo, IncrementResponse, Options, Store } from 'express-rate-limit';
import { query } from '../db.js';

/** The tiny slice of `pg` this store needs; injectable so it can be tested with a stand-in. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

const defaultDb: Queryable = { query: (t, p) => query(t, p) };

/**
 * express-rate-limit store that keeps counters in PostgreSQL, so every server instance shares them.
 *
 * `increment` is ONE atomic upsert: the row's own lock serialises concurrent requests, so two instances
 * can never both read "4 hits" and both write "5". An expired window is reset inside the same statement.
 * Keys are namespaced by limiter name, so the login limiter and the API limiter never share a counter.
 */
export class PgRateLimitStore implements Store {
  /** Counters are keyed in the database, not per process. */
  readonly localKeys = false;
  private windowMs = 60_000;

  constructor(private readonly name: string, private readonly db: Queryable = defaultDb) {}

  private key(k: string) { return `${this.name}:${k}`; }

  init(options: Options) { this.windowMs = options.windowMs; }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const { rows } = await this.db.query('SELECT hits, reset_at FROM rate_limits WHERE key = $1 AND reset_at > now()', [this.key(key)]);
    return rows[0] ? { totalHits: Number(rows[0].hits), resetTime: new Date(rows[0].reset_at) } : undefined;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const { rows } = await this.db.query(
      `INSERT INTO rate_limits AS r (key, hits, reset_at)
       VALUES ($1, 1, now() + make_interval(secs => $2::double precision / 1000.0))
       ON CONFLICT (key) DO UPDATE SET
         hits     = CASE WHEN r.reset_at <= now() THEN 1 ELSE r.hits + 1 END,
         reset_at = CASE WHEN r.reset_at <= now() THEN EXCLUDED.reset_at ELSE r.reset_at END
       RETURNING hits, reset_at`,
      [this.key(key), this.windowMs],
    );
    return { totalHits: Number(rows[0].hits), resetTime: new Date(rows[0].reset_at) };
  }

  async decrement(key: string): Promise<void> {
    await this.db.query('UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1', [this.key(key)]);
  }

  async resetKey(key: string): Promise<void> {
    await this.db.query('DELETE FROM rate_limits WHERE key = $1', [this.key(key)]);
  }

  async resetAll(): Promise<void> {
    await this.db.query('DELETE FROM rate_limits WHERE key LIKE $1', [`${this.name}:%`]);
  }
}

/** Remove counters whose window ended. Called from a timer in the real server (not in tests). */
export async function purgeExpiredRateLimits(db: Queryable = defaultDb): Promise<number> {
  const res = await db.query("DELETE FROM rate_limits WHERE reset_at < now() - interval '1 minute'");
  return res.rowCount ?? 0;
}

export function startRateLimitJanitor(everyMs = 10 * 60_000) {
  const timer = setInterval(() => { purgeExpiredRateLimits().catch((e) => console.error('rate-limit cleanup failed:', e)); }, everyMs);
  timer.unref(); // never keep the process alive just for cleanup
  return timer;
}
