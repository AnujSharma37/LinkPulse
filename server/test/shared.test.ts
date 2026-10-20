/**
 * Tests for the code shared by both backends (shared/ → server/src/shared, supabase/functions/_shared/core).
 * Pure logic only: no database, no network — the Safe Browsing API is replaced by a stand-in `fetch`.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SAFE_BROWSING_ENDPOINT, blocklistCandidates, evaluateUrlSafety, matchesDomain, safeBrowsingLookup, statusFrom,
  type FetchLike, type SafetyReason,
} from '../src/shared/safety-core.js';
import { validateAlias, validateDestination } from '../src/shared/validation.js';

type Reply = { ok: boolean; status: number; json(): Promise<unknown> } | Error;
const ok = (body: unknown): Reply => ({ ok: true, status: 200, json: async () => body });

/** A fake `fetch` that records every call and answers with whatever `respond` returns (or throws an Error). */
function fakeFetch(respond: () => Reply) {
  const calls: { url: string; init: Parameters<FetchLike>[1]; body: any }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = respond();
    if (r instanceof Error) throw r;
    return r;
  };
  return Object.assign(fn, { calls });
}

const noBlocklist = async () => null;
const page = new URL('https://example.com/page');

describe('Safe Browsing lookup (stand-in for the live API)', () => {
  it('sends the documented request: fixed host, POST, encoded key, URL in threatEntries, a timeout signal', async () => {
    const f = fakeFetch(() => ok({}));
    await safeBrowsingLookup('https://example.com/page?a=1', 'k e/y', f);
    const [call] = f.calls;
    expect(call.url).toBe(`${SAFE_BROWSING_ENDPOINT}?key=k%20e%2Fy`);
    expect(call.url.startsWith('https://safebrowsing.googleapis.com/')).toBe(true);
    expect(call.init.method).toBe('POST');
    expect(call.init.headers['content-type']).toBe('application/json');
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    expect(call.body.threatInfo.threatEntries).toEqual([{ url: 'https://example.com/page?a=1' }]);
    expect(call.body.threatInfo.threatEntryTypes).toEqual(['URL']);
    expect(call.body.threatInfo.threatTypes).toEqual(expect.arrayContaining(['MALWARE', 'SOCIAL_ENGINEERING']));
  });

  it('maps responses: {} → clean, matches → match (deduplicated)', async () => {
    expect(await safeBrowsingLookup('https://x.test', 'k', fakeFetch(() => ok({})))).toEqual({ status: 'clean' });
    const hit = ok({ matches: [{ threatType: 'MALWARE' }, { threatType: 'MALWARE' }, { threatType: 'SOCIAL_ENGINEERING' }] });
    expect(await safeBrowsingLookup('https://x.test', 'k', fakeFetch(() => hit))).toEqual({ status: 'match', threats: ['MALWARE', 'SOCIAL_ENGINEERING'] });
  });

  it('reports failures as errors instead of throwing or pretending the URL is clean', async () => {
    const run = (r: Reply) => safeBrowsingLookup('https://x.test', 'k', fakeFetch(() => r));
    expect(await run({ ok: false, status: 429, json: async () => ({}) })).toEqual({ status: 'error', error: 'HTTP 429' });
    expect(await run(new DOMException('timed out', 'TimeoutError'))).toEqual({ status: 'error', error: 'timeout' });
    expect(await run(new TypeError('fetch failed'))).toEqual({ status: 'error', error: 'network error' });
    expect(await run({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } })).toEqual({ status: 'error', error: 'invalid response' });
    expect(await run(ok(null))).toEqual({ status: 'error', error: 'invalid response' });
  });
});

describe('evaluateUrlSafety (labels never overclaim)', () => {
  it('no key → "format_valid" and says reputation was not checked; fetch is never called', async () => {
    const f = fakeFetch(() => ok({}));
    const r = await evaluateUrlSafety(page, { blocklistMatch: noBlocklist, safeBrowsingKey: '', fetchImpl: f });
    expect(r.status).toBe('format_valid');
    expect(r.threatIntel).toBe('not_configured');
    expect(r.reasons.map((x) => x.code)).toContain('threat_intel_not_configured');
    expect(f.calls).toHaveLength(0);
  });

  it('key + clean answer → "no_known_issue"', async () => {
    const r = await evaluateUrlSafety(page, { blocklistMatch: noBlocklist, safeBrowsingKey: 'k', fetchImpl: fakeFetch(() => ok({})) });
    expect(r).toMatchObject({ status: 'no_known_issue', threatIntel: 'checked' });
    expect(r.providers).toContain('google_safe_browsing');
  });

  it('key + match → "blocked" with the threat types in the message', async () => {
    const r = await evaluateUrlSafety(page, { blocklistMatch: noBlocklist, safeBrowsingKey: 'k', fetchImpl: fakeFetch(() => ok({ matches: [{ threatType: 'MALWARE' }] })) });
    expect(r.status).toBe('blocked');
    expect(r.reasons[0]).toMatchObject({ code: 'threat_intel_match', severity: 'block' });
    expect(r.reasons[0].message).toContain('MALWARE');
  });

  it('API failure → NOT "no_known_issue": falls back to "format_valid" with an explanatory note', async () => {
    const r = await evaluateUrlSafety(page, { blocklistMatch: noBlocklist, safeBrowsingKey: 'k', fetchImpl: fakeFetch(() => new TypeError('offline')) });
    expect(r).toMatchObject({ status: 'format_valid', threatIntel: 'error' });
    expect(r.reasons.find((x) => x.code === 'threat_intel_error')?.message).toContain('network error');
  });

  it('a clean Google answer does not hide heuristic warnings', async () => {
    const r = await evaluateUrlSafety(new URL('https://xn--pple-43d.com/'), { blocklistMatch: noBlocklist, safeBrowsingKey: 'k', fetchImpl: fakeFetch(() => ok({})) });
    expect(r.status).toBe('suspicious');
  });

  it('blocklisted or private destinations are refused without calling Google', async () => {
    const f = fakeFetch(() => ok({}));
    const bad = await evaluateUrlSafety(new URL('https://sub.evil.example/x'), { blocklistMatch: async () => 'evil.example', safeBrowsingKey: 'k', fetchImpl: f });
    expect(bad.status).toBe('blocked');
    expect(bad.reasons[0].code).toBe('blocklisted');
    const priv = await evaluateUrlSafety(new URL('http://192.168.1.5/'), { blocklistMatch: noBlocklist, safeBrowsingKey: 'k', fetchImpl: f });
    expect(priv.status).toBe('blocked');
    expect(f.calls).toHaveLength(0);
  });

  it('threatIntel:false skips the lookup even when a key exists', async () => {
    const f = fakeFetch(() => ok({}));
    await evaluateUrlSafety(page, { blocklistMatch: noBlocklist, safeBrowsingKey: 'k', threatIntel: false, fetchImpl: f });
    expect(f.calls).toHaveLength(0);
  });

  it('statusFrom ranks block > warning > checked > unchecked', () => {
    const r = (severity: SafetyReason['severity']): SafetyReason => ({ code: 'x', severity, message: '' });
    expect(statusFrom([r('block'), r('warning')], 'checked')).toBe('blocked');
    expect(statusFrom([r('warning')], 'checked')).toBe('suspicious');
    expect(statusFrom([r('info')], 'checked')).toBe('no_known_issue');
    expect(statusFrom([r('info')], 'error')).toBe('format_valid');
  });
});

describe('blocklist helpers', () => {
  it('matches a domain and its subdomains only', () => {
    expect(matchesDomain('evil.example', 'evil.example')).toBe(true);
    expect(matchesDomain('a.b.evil.example', 'evil.example')).toBe(true);
    expect(matchesDomain('notevil.example', 'evil.example')).toBe(false);
  });
  it('lists the host and its parent domains, never a bare TLD', () => {
    expect(blocklistCandidates('a.b.example.com')).toEqual(['a.b.example.com', 'b.example.com', 'example.com']);
    expect(blocklistCandidates('localhost')).toEqual(['localhost']);
  });
});

describe('shared validation', () => {
  it('rejects links to our own short domain, case-insensitively', () => {
    expect(validateDestination('https://LP.example.com/abc', 'lp.example.com').ok).toBe(false);
    expect(validateDestination('https://other.example.com/abc', 'lp.example.com').ok).toBe(true);
  });
  it('reserves the app’s own pages as aliases', () => {
    for (const a of ['login', 'forgot-password', 'reset-password', 'verify-email']) expect(validateAlias(a).ok, a).toBe(false);
    expect(validateAlias(' My-Event ')).toEqual({ ok: true, alias: 'my-event' });
  });
});

describe('both backends share one copy of this code', () => {
  it('server/src/shared and supabase/functions/_shared/core match /shared exactly (run `npm run sync` if this fails)', () => {
    const script = fileURLToPath(new URL('../../scripts/sync-shared.mjs', import.meta.url));
    expect(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});
