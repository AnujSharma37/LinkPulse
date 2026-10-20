import { config } from '../config.js';
import { query } from '../db.js';
import {
  blocklistCandidates, evaluateUrlSafety, hostOf, isPrivateOrLocalHost, matchesDomain,
  type FetchLike, type SafetyResult,
} from '../shared/safety-core.js';

/**
 * Node binding for the shared safety checks (src/shared/safety-core.ts, generated from /shared).
 * This file only supplies what the shared core cannot know: the blocklist (env + database table).
 */
export {
  heuristicReasons, isPrivateOrLocalHost, safeBrowsingLookup, statusFrom,
  type SafetyReason, type SafetyResult, type SafetyStatus, type Severity,
} from '../shared/safety-core.js';

export async function blocklistMatch(host: string): Promise<string | null> {
  for (const d of config.blocklistDomains) if (matchesDomain(host, d)) return d;
  // Check the host and each parent domain against the DB blocklist in one query.
  const { rows } = await query<{ domain: string }>(
    'SELECT domain FROM blocked_domains WHERE domain = ANY($1) LIMIT 1', [blocklistCandidates(host)],
  );
  return rows[0]?.domain ?? null;
}

export function checkUrlSafety(url: URL, opts: { threatIntel?: boolean; fetchImpl?: FetchLike } = {}): Promise<SafetyResult> {
  return evaluateUrlSafety(url, {
    blocklistMatch,
    safeBrowsingKey: config.safeBrowsingKey,
    threatIntel: opts.threatIntel,
    fetchImpl: opts.fetchImpl,
  });
}

/** Cheap re-check at redirect time: blocklist + private-network rule (no outbound calls). */
export async function isBlockedAtRedirect(destination: string): Promise<boolean> {
  try {
    const host = hostOf(new URL(destination));
    return isPrivateOrLocalHost(host) || (await blocklistMatch(host)) !== null;
  } catch {
    return true;
  }
}
