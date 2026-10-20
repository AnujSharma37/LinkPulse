/**
 * E-mail verification and password reset, against a real database. Emails are captured by the
 * in-memory "outbox" (EMAIL_PROVIDER=memory), so the tests read the one-time links exactly as a user would.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { outbox, type MailMessage } from '../src/lib/mailer.js';
import { app, createLink, newUser, resetDb } from './helpers.js';

beforeAll(resetDb);
afterAll(() => pool.end());
beforeEach(() => { outbox.length = 0; });

const tokenIn = (m: MailMessage) => {
  const found = /[?&]token=([A-Za-z0-9_-]+)/.exec(m.text);
  if (!found) throw new Error(`no token link in email:\n${m.text}`);
  return found[1];
};
const mailsTo = (to: string) => outbox.filter((m) => m.to === to);
const post = (path: string, body: unknown) => request(app).post(`/api/auth/${path}`).send(body as object);
const dest = 'https://example.com/ok';

describe('Email verification', () => {
  it('sends a confirmation link at sign-up; the link works once and marks the account verified', async () => {
    const { agent, user, email } = await newUser('verify1@example.com');
    expect(user.emailVerified).toBe(false);
    const [mail] = mailsTo(email);
    expect(mail.subject).toMatch(/confirm/i);
    expect(mail.text).toContain(`${config.appOrigin}/verify-email?token=`);
    expect(mail.html).toContain('href="');
    const token = tokenIn(mail);

    expect((await post('verify-email', { token })).status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.user.emailVerified).toBe(true);
    const again = await post('verify-email', { token });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('invalid_token');
  });

  it('only stores a hash of the token', async () => {
    const { email } = await newUser('verify-hash@example.com');
    const token = tokenIn(mailsTo(email)[0]);
    const { rows } = await pool.query('SELECT token_hash FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE u.email = $1', [email]);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects garbage, expired and wrong-purpose tokens with the same friendly error', async () => {
    const { email } = await newUser('verify-bad@example.com');
    const token = tokenIn(mailsTo(email)[0]);
    expect((await post('verify-email', { token: 'not-a-real-token' })).body.error.code).toBe('invalid_token');
    expect((await post('verify-email', {})).status).toBe(400);

    await pool.query("UPDATE auth_tokens SET expires_at = now() - interval '1 minute' WHERE purpose = 'verify_email' AND user_id = (SELECT id FROM users WHERE email = $1)", [email]);
    expect((await post('verify-email', { token })).body.error.code).toBe('invalid_token');

    // A password-reset token can't be used to verify an address (and vice versa).
    outbox.length = 0;
    await post('forgot-password', { email });
    const resetToken = tokenIn(mailsTo(email)[0]);
    expect((await post('verify-email', { token: resetToken })).status).toBe(400);
  });

  it('resend issues a fresh link and retires the old one; verified users get no email', async () => {
    const { agent, email } = await newUser('resend@example.com');
    const first = tokenIn(mailsTo(email)[0]);
    outbox.length = 0;
    const res = await agent.post('/api/auth/resend-verification').send({});
    expect(res.status).toBe(200);
    const second = tokenIn(mailsTo(email)[0]);
    expect(second).not.toBe(first);
    expect((await post('verify-email', { token: first })).status).toBe(400); // superseded
    expect((await post('verify-email', { token: second })).status).toBe(200);

    outbox.length = 0;
    const after = await agent.post('/api/auth/resend-verification').send({});
    expect(after.body.alreadyVerified).toBe(true);
    expect(outbox).toHaveLength(0);
    expect((await request(app).post('/api/auth/resend-verification').send({})).status).toBe(401);
  });

  it('can be required before creating links (REQUIRE_EMAIL_VERIFICATION)', async () => {
    const { agent, email } = await newUser('gate@example.com');
    config.requireEmailVerification = true;
    try {
      const blocked = await createLink(agent, { destinationUrl: dest });
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('email_not_verified');
      expect((await agent.get('/api/links')).status).toBe(200); // reading is still allowed

      await post('verify-email', { token: tokenIn(mailsTo(email)[0]) });
      expect((await createLink(agent, { destinationUrl: dest })).status).toBe(201);
    } finally {
      config.requireEmailVerification = false;
    }
  });

  it('does not block link creation when verification is not required (default without a mail provider)', async () => {
    const { agent } = await newUser('optional@example.com');
    expect((await createLink(agent, { destinationUrl: dest })).status).toBe(201);
  });
});

describe('Password reset', () => {
  it('answers identically for known and unknown addresses and only emails real accounts', async () => {
    const { email } = await newUser('reset-known@example.com');
    outbox.length = 0;
    const known = await post('forgot-password', { email });
    const unknown = await post('forgot-password', { email: 'nobody-here@example.com' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(mailsTo(email)).toHaveLength(1);
    expect(mailsTo('nobody-here@example.com')).toHaveLength(0);
    expect(mailsTo(email)[0].text).toContain('/reset-password?token=');
  });

  it('sets a new password, signs out every session, and the link only works once', async () => {
    const { agent, email } = await newUser('reset-flow@example.com'); // signed in as "secret123"
    outbox.length = 0;
    await post('forgot-password', { email });
    const token = tokenIn(mailsTo(email)[0]);
    outbox.length = 0;

    const done = await post('reset-password', { token, password: 'brand-new-pass1' });
    expect(done.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401); // old session revoked
    expect((await post('login', { email, password: 'secret123' })).status).toBe(401);
    expect((await post('login', { email, password: 'brand-new-pass1' })).status).toBe(200);
    expect(mailsTo(email)[0].subject).toMatch(/password was changed/i); // security notice

    const replay = await post('reset-password', { token, password: 'another-pass2' });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('invalid_token');
  });

  it('a weak password is rejected WITHOUT burning the link, so the user can try again', async () => {
    const { email } = await newUser('reset-weak@example.com');
    outbox.length = 0;
    await post('forgot-password', { email });
    const token = tokenIn(mailsTo(email)[0]);
    const weak = await post('reset-password', { token, password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('validation_error');
    expect((await post('reset-password', { token, password: 'a-good-pass9' })).status).toBe(200);
  });

  it('a newer link replaces the older one; expired links are refused', async () => {
    const { email } = await newUser('reset-old@example.com');
    outbox.length = 0;
    await post('forgot-password', { email });
    const older = tokenIn(mailsTo(email)[0]);
    outbox.length = 0;
    await post('forgot-password', { email });
    const newer = tokenIn(mailsTo(email)[0]);
    expect((await post('reset-password', { token: older, password: 'valid-pass1' })).status).toBe(400);

    await pool.query("UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE purpose = 'reset_password' AND user_id = (SELECT id FROM users WHERE email = $1)", [email]);
    expect((await post('reset-password', { token: newer, password: 'valid-pass1' })).status).toBe(400);
  });

  it('proves inbox control, so it also verifies the address', async () => {
    const { email } = await newUser('reset-verifies@example.com');
    outbox.length = 0;
    await post('forgot-password', { email });
    await post('reset-password', { token: tokenIn(mailsTo(email)[0]), password: 'valid-pass1' });
    const { rows } = await pool.query('SELECT email_verified_at FROM users WHERE email = $1', [email]);
    expect(rows[0].email_verified_at).not.toBeNull();
  });

  it('limits how many emails one address (or IP) can trigger', async () => {
    const { email } = await newUser('flood@example.com');
    config.rateLimitDisabled = false;
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await post('forgot-password', { email })).status);
      expect(statuses).toEqual([200, 200, 200, 429]);
    } finally {
      config.rateLimitDisabled = true;
    }
  });
});

describe('Private sign-up (does not reveal which emails are registered)', () => {
  beforeAll(() => { config.privateSignup = true; });
  afterAll(() => { config.privateSignup = false; });
  const signup = (email: string) => request(app).post('/api/auth/signup').send({ email, password: 'secret123' });

  it('gives a new address and an existing one the same answer, and starts no session', async () => {
    const email = 'private1@example.com';
    const fresh = await signup(email);
    expect(fresh.status).toBe(202);
    expect(fresh.body.pending).toBe(true);
    expect(fresh.headers['set-cookie']).toBeUndefined();
    expect(mailsTo(email)[0].text).toContain('/verify-email?token=');

    outbox.length = 0;
    const duplicate = await signup(email);
    expect(duplicate.status).toBe(fresh.status);
    expect(duplicate.body).toEqual(fresh.body);
    expect(duplicate.headers['set-cookie']).toBeUndefined();
    // The real owner is told by email instead, with no way to confirm or take over the account.
    expect(mailsTo(email)).toHaveLength(1);
    expect(mailsTo(email)[0].subject).toMatch(/already have/i);
    expect(mailsTo(email)[0].text).not.toContain('token=');
  });

  it('cannot log in until the address is confirmed; a fresh link is sent, and then login works', async () => {
    const email = 'private2@example.com';
    await signup(email);
    const first = tokenIn(mailsTo(email)[0]);
    outbox.length = 0;

    const early = await post('login', { email, password: 'secret123' });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('email_not_verified');
    expect((await post('login', { email, password: 'wrong-password1' })).status).toBe(401); // wrong password reveals nothing new
    const second = tokenIn(mailsTo(email)[0]);
    expect(second).not.toBe(first);

    expect((await post('verify-email', { token: second })).status).toBe(200);
    const ok = await post('login', { email, password: 'secret123' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.emailVerified).toBe(true);
  });
});
