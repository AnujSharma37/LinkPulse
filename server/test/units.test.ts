import { describe, expect, it } from 'vitest';
import { generateCode, validateAlias } from '../src/lib/shortcode.js';
import { classifyUserAgent, referrerHost } from '../src/shared/ua.js';
import { heuristicReasons, isPrivateOrLocalHost } from '../src/lib/safety.js';
import { validateDestination } from '../src/lib/url.js';

describe('short codes', () => {
  it('are 7 chars from the unambiguous alphabet and practically unique', () => {
    const codes = new Set(Array.from({ length: 20000 }, () => generateCode()));
    expect(codes.size).toBe(20000);
    for (const c of [...codes].slice(0, 200)) expect(c).toMatch(/^[a-km-z2-9]{7}$/);
  });
  it('validates aliases', () => {
    expect(validateAlias('My-Event_26')).toEqual({ ok: true, alias: 'my-event_26' });
    expect(validateAlias('login').ok).toBe(false);
    expect(validateAlias('a b').ok).toBe(false);
  });
});

describe('URL validation', () => {
  it.each([
    ['https://example.com', true], ['http://example.com/a?b=c#d', true], ['HTTPS://EXAMPLE.COM', true],
    ['javascript:alert(1)', false], ['data:text/html,x', false], ['mailto:a@b.c', false], ['//example.com', false],
    ['https://exa\tmple.com', false], ['https://' + 'a'.repeat(2100) + '.com', false],
  ])('%s → %s', (u, ok) => expect(validateDestination(u).ok).toBe(ok));
});

describe('safety heuristics', () => {
  it('detects private hosts in many encodings', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.10', '169.254.169.254', '[::1]', '::ffff:127.0.0.1', 'printer.local'])
      expect(isPrivateOrLocalHost(h), h).toBe(true);
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1']) expect(isPrivateOrLocalHost(h), h).toBe(false);
    expect(heuristicReasons(new URL('http://0x7f000001/')).map((r) => r.code)).toContain('private_network');
  });
  it('flags punycode, shorteners and executables', () => {
    const codes = (u: string) => heuristicReasons(new URL(u)).map((r) => r.code);
    expect(codes('https://xn--pple-43d.com')).toContain('punycode');
    expect(codes('https://bit.ly/abc')).toContain('nested_shortener');
    expect(codes('https://example.com/setup.exe')).toContain('executable_download');
    expect(codes('https://example.com/')).toEqual([]);
  });
});

describe('user agent & referrer', () => {
  it('classifies coarse device categories only', () => {
    expect(classifyUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari').device).toBe('mobile');
    expect(classifyUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0) Safari').device).toBe('tablet');
    expect(classifyUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari').browser).toBe('Chrome');
    expect(classifyUserAgent('Slackbot-LinkExpanding 1.0').device).toBe('bot');
    expect(classifyUserAgent(undefined).device).toBe('unknown');
  });
  it('keeps only the referrer host', () => {
    expect(referrerHost('https://www.google.com/search?q=secret')).toBe('google.com');
    expect(referrerHost('android-app://com.slack')).toBeNull();
  });
});
