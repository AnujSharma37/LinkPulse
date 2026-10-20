// GENERATED from shared/ua.ts by scripts/sync-shared.mjs — DO NOT EDIT HERE.
// Edit shared/ua.ts, then run: npm run sync
/** Tiny user-agent classifier. Only coarse categories are stored, never the raw UA string. */
export function classifyUserAgent(ua: string | undefined) {
  const s = (ua ?? '').toLowerCase();
  if (!s) return { device: 'unknown' as const, browser: null, os: null };
  const isBot = /bot|crawler|spider|crawling|preview|facebookexternalhit|slurp|curl|wget|python-requests|httpclient|headless/.test(s);
  let device: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown' = 'desktop';
  if (isBot) device = 'bot';
  else if (/ipad|tablet|(android(?!.*mobile))/.test(s)) device = 'tablet';
  else if (/mobi|iphone|ipod|android|windows phone/.test(s)) device = 'mobile';

  let browser: string | null = 'Other';
  if (/edg\//.test(s)) browser = 'Edge';
  else if (/opr\/|opera/.test(s)) browser = 'Opera';
  else if (/samsungbrowser/.test(s)) browser = 'Samsung Internet';
  else if (/firefox|fxios/.test(s)) browser = 'Firefox';
  else if (/chrome|crios/.test(s)) browser = 'Chrome';
  else if (/safari/.test(s)) browser = 'Safari';

  let os: string | null = 'Other';
  if (/windows/.test(s)) os = 'Windows';
  else if (/iphone|ipad|ipod|ios/.test(s)) os = 'iOS';
  else if (/android/.test(s)) os = 'Android';
  else if (/mac os|macintosh/.test(s)) os = 'macOS';
  else if (/linux/.test(s)) os = 'Linux';
  return { device, browser, os };
}

/** Keep only the referrer host (privacy). Returns null for direct traffic or garbage. */
export function referrerHost(ref: string | undefined): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '').slice(0, 253);
  } catch {
    return null;
  }
}
