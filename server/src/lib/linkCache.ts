import { config } from '../config.js';
import { TtlCache } from './ttlCache.js';

/**
 * Short-lived cache of link rows for the redirect route (keyed by short code).
 *
 * Why it is safe to cache a mutable row:
 *  - Time-based rules (expiry) are evaluated live against the cached timestamps.
 *  - The click counter is never trusted: consuming a click is ONE atomic SQL statement that re-checks
 *    status, expiry, click limit and block state in the database, so a stale row can never hand out an
 *    extra click or redirect to a disabled link.
 *  - A cached "problem" verdict (disabled, limit reached…) is never shown without re-reading the database,
 *    so re-enabling a link or raising its limit takes effect immediately.
 *  - Writes through this server call `invalidate`/`clear`. Other instances converge within `linkCacheTtlMs`.
 */
export const linkCache = new TtlCache<unknown>(config.linkCacheTtlMs, config.linkCacheMax);

export const invalidateLink = (code: string) => linkCache.delete(code);
export const clearLinkCache = () => linkCache.clear();
