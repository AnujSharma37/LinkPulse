import crypto from 'node:crypto';
import { query, tx } from '../db.js';
import { sha256 } from './auth.js';

export type TokenPurpose = 'verify_email' | 'reset_password';

/**
 * Create a one-time token for `userId`. The raw token is returned once (to be e-mailed); only its SHA-256
 * hash is stored. Any older unused token of the same purpose is retired, so only the newest link works.
 */
export async function issueToken(userId: string, purpose: TokenPurpose, ttlMs: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await tx(async (client) => {
    await client.query('UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [userId, purpose]);
    await client.query(
      'INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [userId, purpose, sha256(token), new Date(Date.now() + ttlMs)],
    );
    // Opportunistic cleanup, same idea as expired sessions.
    await client.query("DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'");
  });
  return token;
}

/**
 * Redeem a token. ONE atomic UPDATE both checks and burns it, so two simultaneous clicks on the same
 * link can't both succeed. Returns the user id, or null if the token is unknown, used, expired or the wrong kind.
 */
export async function consumeToken(token: unknown, purpose: TokenPurpose): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const { rows } = await query<{ user_id: string }>(
    `UPDATE auth_tokens SET used_at = now()
      WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [sha256(token), purpose],
  );
  return rows[0]?.user_id ?? null;
}
