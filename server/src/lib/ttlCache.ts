/**
 * A tiny in-process cache: entries expire after `ttlMs`, and the oldest-used entry is dropped when `max`
 * is exceeded. `ttlMs <= 0` turns caching off completely (get always misses, set does nothing).
 * `ttlMs` is public and mutable so tests (and operators via config) can change it at run time.
 */
export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();

  constructor(public ttlMs: number, public max: number, private readonly now: () => number = Date.now) {}

  get(key: string): V | undefined {
    if (this.ttlMs <= 0) return undefined;
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) { this.map.delete(key); return undefined; }
    // Re-insert so Map order tracks recency of use (least recently used entry is always first).
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.ttlMs <= 0) return;
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
  get size(): number { return this.map.size; }
}
