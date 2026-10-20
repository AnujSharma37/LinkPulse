// GENERATED from shared/validation.ts by scripts/sync-shared.mjs — DO NOT EDIT HERE.
// Edit shared/validation.ts, then run: npm run sync
/**
 * Alias and destination-URL validation, shared by the Node API and the Supabase Edge Functions.
 * Pure functions: no I/O, no imports, so the same file runs on Node and Deno.
 */

/** Paths used by the app itself; a custom alias may never shadow them. */
export const RESERVED_ALIASES = new Set([
  'api', 'app', 'assets', 'static', 'public', 'admin', 'login', 'logout', 'signup', 'register',
  'dashboard', 'links', 'analytics', 'campaigns', 'tags', 'settings', 'account', 'help', 'about',
  'docs', 'health', 'favicon.ico', 'robots.txt', 'index.html', 'www', 'r', 'go', 'qr', 'new',
  'forgot-password', 'reset-password', 'verify-email',
]);

export const ALIAS_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export function validateAlias(raw: string): { ok: true; alias: string } | { ok: false; error: string } {
  const alias = raw.trim().toLowerCase();
  if (!ALIAS_PATTERN.test(alias)) {
    return { ok: false, error: 'Alias must be 3–32 characters: letters, numbers, "-" or "_", starting with a letter or number.' };
  }
  if (RESERVED_ALIASES.has(alias)) return { ok: false, error: `"${alias}" is reserved. Please choose another alias.` };
  return { ok: true, alias };
}

export const MAX_URL_LENGTH = 2048;

export type UrlCheck = { ok: true; url: URL; href: string } | { ok: false; error: string };

/**
 * Structural validation only. It never fetches the URL (no SSRF surface).
 * `ownHost` (e.g. "lp.example.com") rejects links that point back at our own short domain.
 */
export function validateDestination(input: unknown, ownHost?: string): UrlCheck {
  if (typeof input !== 'string') return { ok: false, error: 'Destination URL is required.' };
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'Destination URL is required.' };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, error: `URL is too long (max ${MAX_URL_LENGTH} characters).` };
  // Reject whitespace/control characters anywhere: they are a common smuggling trick.
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return { ok: false, error: 'URL must not contain spaces or control characters.' };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'That is not a valid URL. Include the scheme, e.g. https://example.com' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// URLs are allowed.' };
  }
  if (!url.hostname) return { ok: false, error: 'URL must include a host name.' };
  if (url.href.length > MAX_URL_LENGTH) return { ok: false, error: 'URL is too long after normalisation.' };

  // Prevent redirect loops / chains through our own short domain.
  if (ownHost && url.host.toLowerCase() === ownHost.toLowerCase()) {
    return { ok: false, error: 'You cannot shorten a LinkPulse short link.' };
  }
  return { ok: true, url, href: url.href };
}
