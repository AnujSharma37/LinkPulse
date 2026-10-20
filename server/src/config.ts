import 'dotenv/config';

function bool(v: string | undefined, fallback: boolean) {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 4000);
/** How transactional email is delivered: printed to the log (dev), Resend's HTTPS API, or an in-memory outbox (tests). */
const emailProvider = (process.env.EMAIL_PROVIDER ?? 'console') as 'console' | 'resend' | 'smtp' | 'memory';

export const config = {
  isProd,
  isTest: process.env.NODE_ENV === 'test',
  port,
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/linkpulse',
  databaseSsl: bool(process.env.DATABASE_SSL, false),
  /** Verify the database's TLS certificate (needs a CA your host trusts). Recommended in production when the provider uses a public CA. */
  databaseSslStrict: bool(process.env.DATABASE_SSL_STRICT, false),
  /** Origin of the web app (used for CSRF origin checks). */
  appOrigin: (process.env.APP_ORIGIN ?? `http://localhost:5173`).replace(/\/$/, ''),
  /** Public base URL that short codes are appended to, e.g. https://lpulse.example.com */
  shortBaseUrl: (process.env.SHORT_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 14),
  cookieSecure: bool(process.env.COOKIE_SECURE, isProd),
  bcryptCost: Number(process.env.BCRYPT_COST ?? 12),
  trustProxy: process.env.TRUST_PROXY ?? (isProd ? '1' : 'false'),
  safeBrowsingKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY ?? '',
  blocklistDomains: (process.env.BLOCKLIST_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  /** Set RATE_LIMIT_DISABLED=true only in automated tests. */
  rateLimitDisabled: bool(process.env.RATE_LIMIT_DISABLED, false),
  /**
   * Where rate-limit counters live. "postgres" (default) is shared by every server instance, so limits
   * hold when you scale out; "memory" is per process (fine for a single instance, saves a query per request).
   */
  rateLimitStore: (process.env.RATE_LIMIT_STORE ?? 'postgres') as 'postgres' | 'memory',

  // ── Email (verification + password reset) ──
  emailProvider,
  emailFrom: process.env.EMAIL_FROM ?? 'LinkPulse <no-reply@localhost>',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  /** Any SMTP server (Gmail, Brevo, Mailgun, Postmark, a company relay…). Port 465 = implicit TLS, otherwise STARTTLS. */
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: bool(process.env.SMTP_SECURE, Number(process.env.SMTP_PORT ?? 587) === 465),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  /**
   * When true, unverified accounts can log in but cannot create links. Defaults to true only when real
   * email delivery is configured, so an instance that can't send mail never locks everyone out.
   */
  requireEmailVerification: bool(process.env.REQUIRE_EMAIL_VERIFICATION, emailProvider === 'resend' || emailProvider === 'smtp'),
  /**
   * Private sign-up: POST /auth/signup gives the same answer whether or not the address is already registered
   * ("check your email"), and no session is created until the address is confirmed. This stops the form being
   * used to discover who has an account. Defaults on when real email delivery is configured.
   */
  privateSignup: bool(process.env.PRIVATE_SIGNUP, emailProvider === 'resend' || emailProvider === 'smtp'),
  verifyTokenTtlHours: Number(process.env.VERIFY_TOKEN_TTL_HOURS ?? 24),
  resetTokenTtlMinutes: Number(process.env.RESET_TOKEN_TTL_MINUTES ?? 60),

  // ── Redirect cache (see lib/linkCache.ts) ──
  /** How long a link row may be served from memory before it is re-read. 0 disables the cache. */
  linkCacheTtlMs: Number(process.env.LINK_CACHE_TTL_MS ?? 5000),
  linkCacheMax: Number(process.env.LINK_CACHE_MAX ?? 5000),
};

/**
 * Fail fast in production instead of silently running with development defaults
 * (a localhost database with a well-known password, wrong public URLs, disabled rate limits, weak hashing).
 */
if (config.isProd) {
  const problems: string[] = [];
  for (const name of ['DATABASE_URL', 'APP_ORIGIN', 'SHORT_BASE_URL']) {
    if (!process.env[name]) problems.push(`${name} must be set in production.`);
  }
  if (config.rateLimitDisabled) problems.push('RATE_LIMIT_DISABLED must not be set in production.');
  if (!Number.isInteger(config.bcryptCost) || config.bcryptCost < 10 || config.bcryptCost > 15) {
    problems.push('BCRYPT_COST must be an integer between 10 and 15 in production.');
  }
  if (problems.length) throw new Error(`Unsafe production configuration:\n - ${problems.join('\n - ')}`);
  for (const [name, value] of [['APP_ORIGIN', config.appOrigin], ['SHORT_BASE_URL', config.shortBaseUrl]]) {
    const u = new URL(value);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost') console.warn(`[config] ${name} (${value}) is not https:// — use HTTPS in production.`);
  }
}
