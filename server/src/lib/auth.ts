import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Response } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';

export const SESSION_COOKIE = 'lp_session';

export const hashPassword = (pw: string) => bcrypt.hash(pw, config.bcryptCost);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

// Used when an email doesn't exist so login takes the same time either way (prevents user enumeration by timing).
let dummyHash: string | null = null;
export async function dummyVerify(pw: string) {
  dummyHash ??= await bcrypt.hash('linkpulse-dummy-password', config.bcryptCost);
  await bcrypt.compare(pw, dummyHash);
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function createSession(res: Response, userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionTtlDays * 86_400_000);
  await query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, sha256(token), expires]);
  // Opportunistic cleanup of expired sessions.
  await query('DELETE FROM sessions WHERE expires_at < now()');
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,           // JavaScript cannot read it (XSS can't steal the session)
    secure: config.cookieSecure,
    sameSite: 'lax',          // not sent on cross-site POSTs (CSRF defence, plus the Origin check)
    expires,
    path: '/',
  });
}

export async function userFromToken(token: string | undefined) {
  if (!token || token.length > 100) return null;
  const { rows } = await query<{ id: string; email: string; display_name: string | null; created_at: Date; email_verified_at: Date | null }>(
    `SELECT u.id, u.email, u.display_name, u.created_at, u.email_verified_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

export async function destroySession(res: Response, token: string | undefined) {
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' });
}
