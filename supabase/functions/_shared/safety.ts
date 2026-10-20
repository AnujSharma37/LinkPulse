// Deno binding for the shared safety + validation code in ./core (generated from /shared — do not
// duplicate rules here). This file only supplies the database-backed blocklist.
import type { Sql } from './deps.ts';
import { blocklistCandidates, evaluateUrlSafety, matchesDomain, type SafetyResult } from './core/safety-core.ts';

export { ALIAS_PATTERN, validateAlias, validateDestination } from './core/validation.ts';
export {
  heuristicReasons, isPrivateOrLocalHost,
  type SafetyReason, type SafetyResult, type SafetyStatus,
} from './core/safety-core.ts';

export async function blocklistMatch(sql: Sql, host: string, envList: string[]): Promise<string | null> {
  for (const d of envList) if (matchesDomain(host, d)) return d;
  const candidates = blocklistCandidates(host);
  const rows = await sql`SELECT domain FROM blocked_domains WHERE domain = ANY(${candidates}) LIMIT 1`;
  return rows[0]?.domain ?? null;
}

export function checkUrlSafety(sql: Sql, url: URL, opts: { blocklist: string[]; safeBrowsingKey?: string }): Promise<SafetyResult> {
  return evaluateUrlSafety(url, {
    blocklistMatch: (host) => blocklistMatch(sql, host, opts.blocklist),
    safeBrowsingKey: opts.safeBrowsingKey,
  });
}
