import { describe, expect, it } from 'vitest';
import { TtlCache } from '../src/lib/ttlCache.js';

describe('TtlCache', () => {
  const clock = () => { let t = 1_000; return { now: () => t, tick: (ms: number) => { t += ms; } }; };

  it('serves entries until the TTL passes, then forgets them', () => {
    const c = clock(); const cache = new TtlCache<string>(5_000, 10, c.now);
    cache.set('a', 'x');
    c.tick(4_999); expect(cache.get('a')).toBe('x');
    c.tick(1); expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently USED entry when full', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1); cache.set('b', 2);
    expect(cache.get('a')).toBe(1);      // touching "a" makes "b" the oldest
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1); expect(cache.get('c')).toBe(3);
  });

  it('ttl <= 0 disables caching entirely, and can be switched at run time', () => {
    const cache = new TtlCache<number>(0, 10);
    cache.set('a', 1);
    expect(cache.get('a')).toBeUndefined(); expect(cache.size).toBe(0);
    cache.ttlMs = 1_000; cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    cache.ttlMs = 0;
    expect(cache.get('a')).toBeUndefined();
  });

  it('delete and clear remove entries', () => {
    const cache = new TtlCache<number>(1_000, 10);
    cache.set('a', 1); cache.set('b', 2);
    cache.delete('a'); expect(cache.get('a')).toBeUndefined(); expect(cache.get('b')).toBe(2);
    cache.clear(); expect(cache.size).toBe(0);
  });

  it('overwriting a key refreshes its value and lifetime', () => {
    const c = clock(); const cache = new TtlCache<string>(1_000, 10, c.now);
    cache.set('a', 'old'); c.tick(900); cache.set('a', 'new'); c.tick(900);
    expect(cache.get('a')).toBe('new');
  });
});
