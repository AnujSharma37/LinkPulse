import type { Deps } from '../_shared/deps.ts';
import { passwordPage, problemPage, warningPage, type LinkProblem } from '../_shared/core/pages.ts';
import { ALIAS_PATTERN } from '../_shared/safety.ts';
import { classifyUserAgent, referrerHost } from '../_shared/core/ua.ts';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self' http: https:; frame-ancestors 'none'; base-uri 'none'";
const BASE_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' };

const html = (body: string, status = 200) => new Response(body, { status, headers: { ...BASE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
const problem = (k: LinkProblem) => { const p = problemPage(k); return html(p.html, p.status); };

async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const tooMany = (msg: string) => html(`<!doctype html><meta charset="utf-8"><title>Too many requests</title><p style="font-family:system-ui;padding:3rem;text-align:center">${msg}</p>`, 429);

/**
 * Best-effort client address for rate limiting. `x-forwarded-for` can be written by the client, and the LEFT-most
 * entry is whatever the client chose, so it must never be trusted. Cloudflare's own header (set by the platform,
 * overwritten if a client sends it) is preferred; otherwise the RIGHT-most entry, which is the one our own
 * infrastructure appended. Returns null when no address is available.
 */
export function clientIp(req: Request): string | null {
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const parts = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

/**
 * Public redirect function:  GET|HEAD|POST  /functions/v1/r/<code>
 * All rule checks happen inside lp_resolve_link (one SQL call, atomic click consumption).
 */
export function redirectHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    let code: string;
    try { code = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '').toLowerCase(); } catch { return problem('invalid'); }
    if (!ALIAS_PATTERN.test(code)) return problem('invalid');
    const self = `${deps.env.shortBaseUrl}/${code}`;

    // Visitors: 120 requests per minute per client (the Node API's redirect limit). Skipped if the client can't be identified.
    if (req.method === 'GET' || req.method === 'HEAD') {
      const ip = clientIp(req);
      if (ip) {
        const [{ ok }] = await deps.sql`SELECT lp_rate_limit_hit(${'redirect:' + (await sha256(ip))}, 120, '1 minute') AS ok`;
        if (!ok) return tooMany('Too many requests. Please slow down.');
      }
    }

    let password: string | null = null;
    let confirmed = false;
    let failureLimits: [key: string, limit: number][] = [];
    if (req.method === 'POST') {
      const form = await req.formData().catch(() => null);
      const pw = form?.get('password');
      password = typeof pw === 'string' && pw.length > 0 && pw.length <= 128 ? pw : (typeof pw === 'string' ? '' : null);
      confirmed = form?.get('confirm') === '1';
      // Brute-force protection, two layers (IPs are hashed, never stored):
      //  1. 5 failed attempts per link per client per 15 minutes;
      //  2. 50 failed attempts per link in total per 15 minutes, which holds even if a client manages to fake its address.
      if (password !== null) {
        const perClient: [string, number] = [`unlock:${code}:${await sha256(clientIp(req) ?? 'unknown')}`, 5];
        const perLink: [string, number] = [`unlock-link:${code}`, 50];
        for (const [key, limit] of [perClient, perLink]) {
          const [{ ok }] = await deps.sql`SELECT lp_rate_limit_check(${key}, ${limit}::int, '15 minutes') AS ok`;
          if (!ok) return tooMany('Too many incorrect passwords for this link. Please wait 15 minutes and try again.');
        }
        failureLimits = [perClient, perLink];
      }
    } else if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const ua = classifyUserAgent(req.headers.get('user-agent') ?? undefined);
    const [{ r }] = await deps.sql`
      SELECT lp_resolve_link(${code}, ${password === '' ? ' ' : password}, ${confirmed}, ${req.method !== 'HEAD'},
                             ${referrerHost(req.headers.get('referer') ?? undefined)}, ${ua.device}, ${ua.browser}, ${ua.os}) AS r`;

    switch (r.outcome) {
      case 'not_found': case 'disabled': case 'expired': case 'limit_reached': case 'blocked':
        return problem(r.outcome);
      case 'password_required':
        return html(passwordPage(code, { warnings: r.warnings }).replace(`action="/${code}"`, `action="${self}"`));
      case 'wrong_password':
        for (const [key, limit] of failureLimits) await deps.sql`SELECT lp_rate_limit_hit(${key}, ${limit}::int, '15 minutes')`;
        return html(passwordPage(code, { error: 'Incorrect password. Please try again.', warnings: r.warnings }).replace(`action="/${code}"`, `action="${self}"`), 401);
      case 'warning':
        return html(warningPage(code, r.destination, r.warnings).replace(`action="/${code}"`, `action="${self}"`));
      case 'ok_no_consume':
        return new Response(null, { status: 200, headers: BASE_HEADERS });
      case 'redirect': {
        const target = new URL(r.destination);
        for (const [k, val] of Object.entries(r.utm ?? {})) if (!target.searchParams.has(k)) target.searchParams.set(k, String(val));
        return new Response(null, { status: req.method === 'POST' ? 303 : 302, headers: { ...BASE_HEADERS, Location: target.href } });
      }
      default:
        return problem('not_found');
    }
  };
}
