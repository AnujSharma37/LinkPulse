import express from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { SESSION_COOKIE, createSession, destroySession, dummyVerify, hashPassword, verifyPassword } from '../lib/auth.js';
import { consumeToken, issueToken } from '../lib/authTokens.js';
import { accountExistsMessage, passwordChangedMessage, resetPasswordMessage, verifyEmailMessage } from '../lib/emails.js';
import { HttpError, conflict } from '../lib/errors.js';
import { sendMailInBackground } from '../lib/mailer.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter, emailAddressLimiter, emailIpLimiter, loginAccountLimiter } from '../middleware/security.js';

export const authRouter = express.Router();

const email = z.string().trim().toLowerCase().max(254).email('Enter a valid email address.');
const newPassword = z.string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), 'Password must contain at least one letter and one number.');
const signupSchema = z.object({ email, password: newPassword, displayName: z.string().trim().max(80).optional() }).strict();
const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required.').max(128) }).strict();
// Token strings are validated by lookup, not by shape, so a malformed one gets the same friendly error as an expired one.
const tokenSchema = z.object({ token: z.string().max(200) }).strict();
const forgotSchema = z.object({ email }).strict();
const resetSchema = z.object({ token: z.string().max(200), password: newPassword }).strict();

type UserRow = { id: string; email: string; display_name: string | null; created_at: Date; email_verified_at: Date | null };
const publicUser = (u: UserRow) =>
  ({ id: u.id, email: u.email, displayName: u.display_name, createdAt: u.created_at, emailVerified: Boolean(u.email_verified_at) });

const invalidToken = (what: string) =>
  new HttpError(400, 'invalid_token', `This ${what} link is invalid, has expired, or was already used. Please request a new one.`);

async function sendVerificationEmail(user: { id: string; email: string }) {
  const token = await issueToken(user.id, 'verify_email', config.verifyTokenTtlHours * 3_600_000);
  sendMailInBackground(verifyEmailMessage(user.email, token));
}

/** Same body for "new account" and "already registered" in private-signup mode, so it reveals nothing. */
const PENDING = { pending: true, message: 'Check your email to finish creating your account.' } as const;

authRouter.post('/signup', authLimiter, emailAddressLimiter, async (req, res) => {
  const body = signupSchema.parse(req.body);
  const hash = await hashPassword(body.password);
  try {
    const { rows } = await query<UserRow>(
      'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name, created_at, email_verified_at',
      [body.email, hash, body.displayName || null],
    );
    // A failure to queue the welcome email must not undo a successful sign-up; the user can resend it.
    const queued = sendVerificationEmail(rows[0]).catch((e) => console.error('[signup] could not issue verification email:', e));
    if (config.privateSignup) {
      // No session until the address is confirmed.
      await queued;
      return res.status(202).json(PENDING);
    }
    await createSession(res, rows[0].id);
    await queued;
    res.status(201).json({ user: publicUser(rows[0]) });
  } catch (e: any) {
    if (e.code === '23505') {
      if (config.privateSignup) {
        // Tell the real owner by email instead of telling the visitor.
        sendMailInBackground(accountExistsMessage(body.email));
        return res.status(202).json(PENDING);
      }
      throw conflict('An account with this email already exists. Try logging in.');
    }
    throw e;
  }
});

authRouter.post('/login', authLimiter, loginAccountLimiter, async (req, res) => {
  const body = loginSchema.parse(req.body);
  const { rows } = await query(
    'SELECT id, email, display_name, created_at, email_verified_at, password_hash FROM users WHERE lower(email) = $1', [body.email]);
  const user = rows[0];
  const ok = user ? await verifyPassword(body.password, user.password_hash) : (await dummyVerify(body.password), false);
  // Same message whether the email or the password was wrong: don't reveal which accounts exist.
  if (!ok) throw new HttpError(401, 'invalid_credentials', 'Incorrect email or password.');
  if (config.privateSignup && !user.email_verified_at) {
    // The password was right, so it is safe to say why login is refused — and to send a fresh link.
    await sendVerificationEmail(user).catch((e) => console.error('[login] could not issue verification email:', e));
    throw new HttpError(403, 'email_not_verified', 'Please confirm your email address first. We just sent you a new confirmation link.');
  }
  await createSession(res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', async (req, res) => {
  await destroySession(res, req.cookies?.[SESSION_COOKIE]);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

// ── E-mail verification ────────────────────────────────────────────

/** Redeem the link from the verification email. The token itself is the credential, so no login is needed. */
authRouter.post('/verify-email', authLimiter, async (req, res) => {
  const { token } = tokenSchema.parse(req.body);
  const userId = await consumeToken(token, 'verify_email');
  if (!userId) throw invalidToken('verification');
  await query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1', [userId]);
  res.json({ ok: true });
});

authRouter.post('/resend-verification', requireAuth, emailIpLimiter, emailAddressLimiter, async (req, res) => {
  if (req.user!.email_verified_at) return res.json({ ok: true, alreadyVerified: true });
  await sendVerificationEmail(req.user!);
  res.json({ ok: true });
});

// ── Password reset ─────────────────────────────────────────────────

/**
 * Always answers 200 with the same body, whether or not the address has an account, so this endpoint
 * can't be used to discover who is registered. The slow part (delivering the email) happens in the
 * background, so the response time doesn't reveal it either.
 */
authRouter.post('/forgot-password', emailIpLimiter, emailAddressLimiter, async (req, res) => {
  const { email: address } = forgotSchema.parse(req.body);
  const { rows } = await query<{ id: string; email: string }>('SELECT id, email FROM users WHERE lower(email) = $1', [address]);
  if (rows[0]) {
    const token = await issueToken(rows[0].id, 'reset_password', config.resetTokenTtlMinutes * 60_000);
    sendMailInBackground(resetPasswordMessage(rows[0].email, token));
  }
  res.json({ ok: true });
});

/**
 * Set a new password with a reset token. Afterwards: every session is revoked (whoever had access
 * with the old password is signed out), any other pending reset links die, and the address counts as
 * verified because the user just proved they control the inbox.
 */
authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const body = resetSchema.parse(req.body);
  // Redeem first so invalid tokens never cost us a bcrypt hash. If something fails after this point the
  // user simply requests a new link.
  const userId = await consumeToken(body.token, 'reset_password');
  if (!userId) throw invalidToken('password reset');
  const hash = await hashPassword(body.password);
  const user = await tx(async (client) => {
    const { rows } = await client.query<{ email: string }>(
      'UPDATE users SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $2 RETURNING email',
      [hash, userId],
    );
    await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await client.query("UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL", [userId]);
    return rows[0];
  });
  if (user) sendMailInBackground(passwordChangedMessage(user.email));
  res.json({ ok: true });
});
