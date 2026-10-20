// GENERATED from shared/safety-core.ts by scripts/sync-shared.mjs — DO NOT EDIT HERE.
// Edit shared/safety-core.ts, then run: npm run sync
/**
 * LinkPulse safety checks — the pure part, shared by the Node API and the Supabase Edge Functions.
 *
 * Status meanings (shown to users exactly like this — we never say "safe"):
 *  - format_valid   : URL is structurally valid; no reputation lookup was performed.
 *  - no_known_issue : threat-intelligence lookup ran and found nothing, and no heuristic flags.
 *                     This is NOT a guarantee that the destination is safe.
 *  - suspicious     : one or more heuristics flagged the URL. Visitors see a warning page first.
 *  - blocked        : URL matches a blocklist / threat feed or a forbidden target. Link is refused.
 *
 * The destination is NEVER fetched by the server, so these checks have no SSRF surface.
 * The only outbound call is to Google Safe Browsing's fixed API host, and only if a key is configured.
 *
 * Everything that touches a database (the blocklist table) is injected, so this file has no
 * dependencies besides `node:net` and runs unchanged on Node and Deno.
 */
import { isIP } from 'node:net';

export type SafetyStatus = 'format_valid' | 'no_known_issue' | 'suspicious' | 'blocked';
export type Severity = 'info' | 'warning' | 'block';
export interface SafetyReason { code: string; severity: Severity; message: string }
export interface SafetyResult {
  status: SafetyStatus;
  reasons: SafetyReason[];
  providers: string[];
  threatIntel: 'checked' | 'not_configured' | 'error';
}

const SHORTENER_HOSTS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'ow.ly', 'buff.ly', 'rebrand.ly', 'cutt.ly',
  'shorturl.at', 'rb.gy', 'tiny.cc', 'bl.ink', 'short.io', 'v.gd',
]);
// TLDs that are frequently abused or easily confused with file names. A heuristic, not a verdict.
const RISKY_TLDS = new Set(['zip', 'mov', 'tk', 'ml', 'ga', 'cf', 'gq']);
const RISKY_EXTENSIONS = /\.(exe|msi|scr|bat|cmd|com|pif|apk|jar|vbs|ps1|dmg|pkg)$/i;
const CREDENTIAL_WORDS = /(login|signin|sign-in|verify|account|password|wallet|bank|update-?billing)/i;

export function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) {
    return true;
  }
  const kind = isIP(h);
  if (kind === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (kind === 6) {
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true;
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateOrLocalHost(mapped[1]);
    const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const n = (parseInt(mappedHex[1], 16) << 16) | parseInt(mappedHex[2], 16);
      return isPrivateOrLocalHost([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
  }
  return false;
}

/** Normalised host name of a URL (lower-case, no IPv6 brackets). */
export const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

/** Does `host` equal `domain` or sit underneath it (sub.domain)? */
export function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain);
}

/** The host and each parent domain ("a.b.example.com" → a.b.example.com, b.example.com, example.com). */
export function blocklistCandidates(host: string): string[] {
  const labels = host.split('.');
  return labels.map((_, i) => labels.slice(i).join('.')).filter((c) => c.includes('.') || c === host);
}

/** Heuristic checks that need no network access at all. */
export function heuristicReasons(url: URL): SafetyReason[] {
  const reasons: SafetyReason[] = [];
  const host = hostOf(url);

  if (isPrivateOrLocalHost(host)) {
    reasons.push({ code: 'private_network', severity: 'block', message: 'Points to a private, local or reserved network address. Short links must lead to public websites.' });
  } else if (isIP(host)) {
    reasons.push({ code: 'ip_host', severity: 'warning', message: 'Uses a raw IP address instead of a domain name, which is common in phishing links.' });
  }
  if (url.username || url.password) {
    reasons.push({ code: 'embedded_credentials', severity: 'warning', message: 'Contains a username/password before the "@" sign — a known trick to disguise the real host.' });
  }
  if (host.split('.').some((l) => l.startsWith('xn--'))) {
    reasons.push({ code: 'punycode', severity: 'warning', message: 'Uses an internationalised (punycode) domain that may imitate another site’s name.' });
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    reasons.push({ code: 'unusual_port', severity: 'warning', message: `Uses an unusual port (${url.port}).` });
  }
  if (host.split('.').length > 5) {
    reasons.push({ code: 'many_subdomains', severity: 'warning', message: 'Has an unusually deep chain of subdomains.' });
  }
  const tld = host.split('.').pop() ?? '';
  if (RISKY_TLDS.has(tld)) {
    reasons.push({ code: 'risky_tld', severity: 'warning', message: `Uses the ".${tld}" top-level domain, which is frequently abused or confused with file names.` });
  }
  if (SHORTENER_HOSTS.has(host.replace(/^www\./, ''))) {
    reasons.push({ code: 'nested_shortener', severity: 'warning', message: 'Points to another URL shortener, which hides the final destination.' });
  }
  if (RISKY_EXTENSIONS.test(url.pathname)) {
    reasons.push({ code: 'executable_download', severity: 'warning', message: 'Appears to download an executable or installer file.' });
  }
  if (url.protocol === 'http:' && CREDENTIAL_WORDS.test(url.pathname + url.search)) {
    reasons.push({ code: 'insecure_credentials_page', severity: 'warning', message: 'Looks like a login/account page served over unencrypted HTTP.' });
  }
  if (url.href.length > 1000) {
    reasons.push({ code: 'very_long', severity: 'info', message: 'The URL is very long, which can hide its real purpose.' });
  }
  if (url.protocol === 'http:') {
    reasons.push({ code: 'not_https', severity: 'info', message: 'Uses HTTP, not HTTPS: traffic to this site is not encrypted.' });
  }
  return reasons;
}

export type SafeBrowsingOutcome =
  | { status: 'match'; threats: string[] }
  | { status: 'clean' }
  | { status: 'error'; error: string };

export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const SAFE_BROWSING_ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';

/**
 * Optional Google Safe Browsing v4 lookup. Fixed API host, 3 s timeout, key from server env only.
 * `fetchImpl` is injectable so the request/response handling can be unit-tested without the network.
 */
export async function safeBrowsingLookup(
  href: string,
  key: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = 3000,
): Promise<SafeBrowsingOutcome> {
  try {
    const res = await fetchImpl(`${SAFE_BROWSING_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        client: { clientId: 'linkpulse', clientVersion: '1.0.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url: href }],
        },
      }),
    });
    if (!res.ok) return { status: 'error', error: `HTTP ${res.status}` };
    const body = (await res.json()) as { matches?: { threatType: string }[] } | null;
    // The API returns `{}` when nothing matches; anything that is not an object is a broken response.
    if (body === null || typeof body !== 'object') return { status: 'error', error: 'invalid response' };
    if (body.matches?.length) return { status: 'match', threats: [...new Set(body.matches.map((m) => m.threatType))] };
    return { status: 'clean' };
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') return { status: 'error', error: 'timeout' };
    if (e instanceof SyntaxError) return { status: 'error', error: 'invalid response' };
    return { status: 'error', error: 'network error' };
  }
}

export interface EvaluateDeps {
  /** Returns the matching blocklist domain, or null. Backed by a database table in each backend. */
  blocklistMatch: (host: string) => Promise<string | null>;
  /** Safe Browsing API key; empty/undefined means "not configured". */
  safeBrowsingKey?: string;
  /** Set false to skip the threat-intelligence call even when a key exists. */
  threatIntel?: boolean;
  fetchImpl?: FetchLike;
}

/** Turn a list of reasons (+ whether threat intel ran) into the final status label. */
export function statusFrom(reasons: SafetyReason[], threatIntel: SafetyResult['threatIntel']): SafetyStatus {
  if (reasons.some((r) => r.severity === 'block')) return 'blocked';
  if (reasons.some((r) => r.severity === 'warning')) return 'suspicious';
  return threatIntel === 'checked' ? 'no_known_issue' : 'format_valid';
}

export async function evaluateUrlSafety(url: URL, deps: EvaluateDeps): Promise<SafetyResult> {
  const reasons = heuristicReasons(url);
  const providers = ['format', 'heuristics', 'blocklist'];

  const blocked = await deps.blocklistMatch(hostOf(url));
  if (blocked) {
    reasons.unshift({ code: 'blocklisted', severity: 'block', message: `The domain "${blocked}" is on this LinkPulse instance's blocklist.` });
  }

  let threatIntel: SafetyResult['threatIntel'] = 'not_configured';
  const key = deps.safeBrowsingKey;
  const hardBlocked = reasons.some((r) => r.severity === 'block');
  if (key && deps.threatIntel !== false && !hardBlocked) {
    providers.push('google_safe_browsing');
    const sb = await safeBrowsingLookup(url.href, key, deps.fetchImpl);
    if (sb.status === 'match') {
      threatIntel = 'checked';
      reasons.unshift({ code: 'threat_intel_match', severity: 'block', message: `Google Safe Browsing lists this URL as: ${sb.threats.join(', ')}.` });
    } else if (sb.status === 'clean') {
      threatIntel = 'checked';
    } else {
      threatIntel = 'error';
      reasons.push({ code: 'threat_intel_error', severity: 'info', message: `Threat-intelligence lookup failed (${sb.error}); reputation was not checked.` });
    }
  } else if (!key) {
    reasons.push({ code: 'threat_intel_not_configured', severity: 'info', message: 'No threat-intelligence service is configured, so the site’s reputation was not checked.' });
  }

  return { status: statusFrom(reasons, threatIntel), reasons, providers, threatIntel };
}
