import type { NextFunction, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { PgRateLimitStore } from '../lib/pgRateLimitStore.js';

/**
 * CSRF defence for the JSON API: state-changing requests must come from our own web app.
 * Browsers always send Origin on cross-site POST/PATCH/DELETE, so a forged request is rejected here.
 * We also require a JSON content type, which a plain HTML form cannot send.
 */
export function apiCsrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const allowed = new Set([config.appOrigin, config.shortBaseUrl]);
  if (origin && !allowed.has(origin)) throw new HttpError(403, 'forbidden_origin', 'Request origin not allowed.');
  if (req.method !== 'DELETE' && !req.is('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Requests must use Content-Type: application/json.');
  }
  next();
}

/** One store per limiter (namespaced by name). Postgres by default so limits are shared across instances. */
const storeFor = (name: string) => (config.rateLimitStore === 'postgres' ? new PgRateLimitStore(name) : undefined);

function limiter(name: string, windowMs: number, limit: number, message: string, key?: (req: Request) => string) {
  return rateLimit({
    windowMs,
    limit,
    store: storeFor(name),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.rateLimitDisabled,
    keyGenerator: key ?? ((req) => ipKeyGenerator(req.ip ?? 'unknown')),
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited', message } });
    },
  });
}

export const apiLimiter = limiter('api', 60_000, 300, 'Too many requests. Please slow down.');
export const authLimiter = limiter('auth', 15 * 60_000, 20, 'Too many login or sign-up attempts. Try again in 15 minutes.');
export const createLinkLimiter = limiter('create-link', 60 * 60_000, 100, 'You have created too many links this hour. Try again later.',
  (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'));
/**
 * Per-ACCOUNT brute-force limit for login: 10 FAILED attempts per email address per 15 minutes, from any number
 * of IP addresses (the IP-based authLimiter can't see a distributed attack on one account). Successful logins
 * are not counted. Trade-off: someone can lock a known address out of logging in for 15 minutes.
 */
export const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  store: storeFor('login-account'),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.rateLimitDisabled,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => emailKey(req) || ipKeyGenerator(req.ip ?? 'unknown'),
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'rate_limited', message: 'Too many failed login attempts for this account. Try again in 15 minutes, or reset your password.' } });
  },
});
export const redirectLimiter = limiter('redirect', 60_000, 120, 'Too many requests.');
/**
 * E-mail sending limits (password reset, resend verification). Two layers: per IP, and per target address
 * so nobody can use us to flood one inbox. The limited response is the same whether or not the account exists.
 */
const emailKey = (req: Request) => String((req.body as { email?: unknown } | undefined)?.email ?? req.user?.email ?? '').trim().toLowerCase().slice(0, 254);
export const emailIpLimiter = limiter('email-ip', 60 * 60_000, 10, 'Too many email requests. Please try again later.');
export const emailAddressLimiter = limiter('email-addr', 60 * 60_000, 3, 'Too many email requests for this address. Please try again later.',
  (req) => emailKey(req) || ipKeyGenerator(req.ip ?? 'unknown'));

/**
 * Brute-force protection for password-protected links: 5 FAILED attempts per link per IP per 15 min.
 * Successful unlocks (a 3xx redirect) are not counted, so a correct password is never blocked by earlier typos.
 */
export const unlockLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  store: storeFor('unlock'),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.rateLimitDisabled,
  skipSuccessfulRequests: true, // only failed attempts (status >= 400) count
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? 'unknown')}:${String(req.params.code ?? '').toLowerCase()}`,
  handler: (_req, res) => {
    res.status(429).type('html').send(
      '<!doctype html><meta charset="utf-8"><title>Too many attempts</title><body style="font-family:system-ui;padding:3rem;text-align:center"><h1>Too many attempts</h1><p>Too many incorrect passwords for this link. Please wait 15 minutes and try again.</p></body>',
    );
  },
});

/** Block link creation until the e-mail address is confirmed (only when REQUIRE_EMAIL_VERIFICATION is on). */
export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction) {
  if (config.requireEmailVerification && req.user && !req.user.email_verified_at) {
    throw new HttpError(403, 'email_not_verified', 'Please verify your email address to create links. Check your inbox, or request a new verification email.');
  }
  next();
}
