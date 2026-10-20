import express, { type Request, type Response } from 'express';
import { query } from '../db.js';
import { verifyPassword } from '../lib/auth.js';
import { linkCache } from '../lib/linkCache.js';
import { ALIAS_PATTERN } from '../lib/shortcode.js';
import { isBlockedAtRedirect } from '../lib/safety.js';
import { classifyUserAgent, referrerHost } from '../shared/ua.js';
import { redirectLimiter, unlockLimiter } from '../middleware/security.js';
import { passwordPage, problemPage, warningPage, type LinkProblem } from '../shared/pages.js';

/**
 * The public short-link route:  GET /:code  (and POST /:code for password / warning confirmation).
 *
 * Order of checks (every one is enforced on the server):
 *   1. code format  → 2. exists  → 3. disabled  → 4. expired  → 5. click limit
 *   → 6. blocklist re-check → 7. password → 8. suspicious-warning confirmation
 *   → 9. atomically consume one click + record event → 10. 302 redirect to the STORED destination.
 * The redirect target only ever comes from the database, never from the request (no open redirect).
 */
export const redirectRouter = express.Router();

interface LinkRow {
  id: string; code: string; destination_url: string; status: string; expires_at: Date | null;
  password_hash: string | null; max_clicks: number | null; click_count: number; campaign_id: string | null;
  safety_status: string; safety_reasons: { severity: string; message: string }[];
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
}

function sendProblem(res: Response, kind: LinkProblem) {
  const p = problemPage(kind);
  res.status(p.status).set('Cache-Control', 'no-store').set('Content-Security-Policy', PAGE_CSP).type('html').send(p.html);
}

/** Read a link (and its campaign's UTM tags) from the database and refresh the cache. */
async function loadLink(code: string): Promise<LinkRow | null> {
  const { rows } = await query<LinkRow>(
    `SELECT l.id, l.code, l.destination_url, l.status, l.expires_at, l.password_hash, l.max_clicks, l.click_count,
            l.campaign_id, l.safety_status, l.safety_reasons, c.utm_source, c.utm_medium, c.utm_campaign
       FROM links l LEFT JOIN campaigns c ON c.id = l.campaign_id
      WHERE l.code = $1`,
    [code],
  );
  const link = rows[0] ?? null;
  if (link) linkCache.set(code, link); else linkCache.delete(code);
  return link;
}

/** Returns a problem if the link can't be used right now, otherwise null. */
async function gate(link: LinkRow | null): Promise<LinkProblem | null> {
  if (!link) return 'not_found';
  if (link.status !== 'active') return 'disabled';
  if (link.expires_at && link.expires_at.getTime() <= Date.now()) return 'expired';
  if (link.max_clicks !== null && link.click_count >= link.max_clicks) return 'limit_reached';
  if (link.safety_status === 'blocked' || (await isBlockedAtRedirect(link.destination_url))) return 'blocked';
  return null;
}

/**
 * Find the link and decide whether it can be used right now. A cached row may answer "yes, usable"
 * (the click itself is re-checked atomically later), but a cached "no" is never trusted: we re-read the
 * database first, so changes made elsewhere (re-enabled, limit raised, extended expiry) apply immediately.
 */
async function resolveLink(code: string): Promise<{ link: LinkRow | null; problem: LinkProblem | null }> {
  const cached = linkCache.get(code) as LinkRow | undefined;
  if (cached && !(await gate(cached))) return { link: cached, problem: null };
  const link = await loadLink(code);
  return { link, problem: await gate(link) };
}

/** Add the campaign's UTM parameters, without overwriting any the destination already has. */
function withUtm(link: LinkRow): string {
  const url = new URL(link.destination_url);
  const pairs: [string, string | null][] = [['utm_source', link.utm_source], ['utm_medium', link.utm_medium], ['utm_campaign', link.utm_campaign]];
  for (const [k, v] of pairs) if (v && !url.searchParams.has(k)) url.searchParams.set(k, v);
  return url.href;
}

/**
 * Atomically use one click AND record the click event, in a single SQL statement (one database round trip).
 * The UPDATE's WHERE clause re-checks every rule, so two visitors racing for the last allowed click can't
 * both succeed: Postgres row locking serialises them. The INSERT only runs for rows the UPDATE returned,
 * so a refused click never leaves an event behind, and one statement is atomic without BEGIN/COMMIT.
 *
 * The password hash and destination are part of the WHERE clause as well: the row we hold may come from
 * the cache, and a link that gained a password (or a new destination) a moment ago must never be served
 * the old way. When they differ the click is refused and `finish` starts over with fresh data.
 */
async function consumeClick(link: LinkRow, req: Request): Promise<string | null> {
  const ua = classifyUserAgent(req.get('user-agent'));
  const target = withUtm(link);
  const tu = new URL(target);
  const { rowCount } = await query(
    `WITH hit AS (
       UPDATE links SET click_count = click_count + 1, last_clicked_at = now()
        WHERE id = $1 AND status = 'active' AND safety_status <> 'blocked'
          AND (expires_at IS NULL OR expires_at > now())
          AND (max_clicks IS NULL OR click_count < max_clicks)
          AND password_hash IS NOT DISTINCT FROM $10::text AND destination_url = $11::text
       RETURNING id)
     INSERT INTO click_events (link_id, referrer_host, device_type, browser, os, campaign_id, utm_source, utm_medium, utm_campaign)
     SELECT id, $2::text, $3::text, $4::text, $5::text, $6::uuid, $7::text, $8::text, $9::text FROM hit`,
    [link.id, referrerHost(req.get('referer')), ua.device, ua.browser, ua.os, link.campaign_id,
      tu.searchParams.get('utm_source'), tu.searchParams.get('utm_medium'), tu.searchParams.get('utm_campaign'),
      link.password_hash, link.destination_url],
  );
  return rowCount === 1 ? target : null;
}

const warningsOf = (link: LinkRow) =>
  link.safety_status === 'suspicious' ? link.safety_reasons.filter((r) => r.severity === 'warning').map((r) => r.message) : [];

/**
 * CSP for the interstitial pages. form-action must allow http/https because browsers apply it to the
 * redirect that follows a form POST (password unlock / warning confirmation) — the target is the
 * link's stored destination, which can be any public website.
 */
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self' http: https:; frame-ancestors 'none'; base-uri 'none'";

function noStore(res: Response) {
  res.set('Content-Security-Policy', PAGE_CSP);
  // Never let browsers/CDNs cache a redirect: limits, expiry and disabling must apply on every visit.
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Referrer-Policy', 'no-referrer');
}

async function finish(res: Response, req: Request, link: LinkRow) {
  const target = await consumeClick(link, req);
  if (!target) {
    // The click was refused. Re-read the link to find out why, bypassing the cache.
    const fresh = await loadLink(link.code);
    const problem = await gate(fresh);
    if (problem) return sendProblem(res, problem); // e.g. lost the race for the last allowed click
    // Still usable, but it changed after we read it (new password or destination): start over with fresh data.
    noStore(res);
    return res.redirect(303, `/${link.code}`);
  }
  noStore(res);
  res.redirect(req.method === 'POST' ? 303 : 302, target);
}

redirectRouter.get('/:code', redirectLimiter, async (req, res) => {
  const code = String(req.params.code).toLowerCase();
  if (!ALIAS_PATTERN.test(code)) return sendProblem(res, 'invalid');
  const { link, problem } = await resolveLink(code);
  if (problem) return sendProblem(res, problem);
  noStore(res);
  if (link!.password_hash) return res.type('html').send(passwordPage(code, { warnings: warningsOf(link!) }));
  const warnings = warningsOf(link!);
  if (warnings.length) return res.type('html').send(warningPage(code, link!.destination_url, warnings));
  // HEAD requests (link previews, uptime checkers) don't consume clicks.
  if (req.method === 'HEAD') return res.status(200).end();
  return finish(res, req, link!);
});

redirectRouter.post('/:code', express.urlencoded({ extended: false, limit: '2kb' }), unlockLimiter, async (req, res) => {
  const code = String(req.params.code).toLowerCase();
  if (!ALIAS_PATTERN.test(code)) return sendProblem(res, 'invalid');
  const { link, problem } = await resolveLink(code);
  if (problem) return sendProblem(res, problem);
  noStore(res);

  if (link!.password_hash) {
    const pw = typeof req.body?.password === 'string' ? req.body.password : '';
    const ok = pw.length > 0 && pw.length <= 128 && (await verifyPassword(pw, link!.password_hash));
    if (!ok) {
      return res.status(401).type('html').send(passwordPage(code, { error: 'Incorrect password. Please try again.', warnings: warningsOf(link!) }));
    }
    return finish(res, req, link!);
  }
  if (warningsOf(link!).length && req.body?.confirm === '1') return finish(res, req, link!);
  // Nothing to submit for this link: send the visitor through the normal GET flow.
  return res.redirect(303, `/${code}`);
});
