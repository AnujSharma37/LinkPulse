/**
 * End-to-end API tests for the 10 required user journeys (journey 10, responsive UI, is covered by Playwright).
 * They run against a real PostgreSQL database — nothing is mocked.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { config } from '../src/config.js';
import { app, createLink, newUser, resetDb } from './helpers.js';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('Journey 1 — sign up and log in', () => {
  it('signs up, reads /me, logs out, logs back in', async () => {
    const agent = request.agent(app);
    const signup = await agent.post('/api/auth/signup').send({ email: 'Asha@Example.com', password: 'secret123' });
    expect(signup.status).toBe(201);
    expect(signup.body.user.email).toBe('asha@example.com');
    expect(signup.headers['set-cookie'][0]).toMatch(/lp_session=.*HttpOnly.*SameSite=Lax/i);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await agent.post('/api/auth/logout').send({})).status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const login = await agent.post('/api/auth/login').send({ email: 'asha@example.com', password: 'secret123' });
    expect(login.status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.user.email).toBe('asha@example.com');
  });

  it('rejects duplicate emails, weak passwords and wrong credentials with generic errors', async () => {
    const dup = await request(app).post('/api/auth/signup').send({ email: 'asha@example.com', password: 'secret123' });
    expect(dup.status).toBe(409);
    const weak = await request(app).post('/api/auth/signup').send({ email: 'b@example.com', password: 'short' });
    expect(weak.status).toBe(400);
    const wrongPw = await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'nope12345' });
    const noUser = await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'nope12345' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body.error.message).toBe(noUser.body.error.message);
  });

  it('stores passwords as bcrypt hashes only', async () => {
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE email = 'asha@example.com'");
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
    expect(rows[0].password_hash).not.toContain('secret123');
  });

  it('blocks API calls without a session and cross-origin writes', async () => {
    expect((await request(app).get('/api/links')).status).toBe(401);
    const { agent } = await newUser();
    const forged = await agent.post('/api/links').set('Origin', 'https://attacker.example').send({ destinationUrl: 'https://example.com' });
    expect(forged.status).toBe(403);
    const formPost = await agent.post('/api/links').type('form').send('destinationUrl=https://example.com');
    expect(formPost.status).toBe(415);
  });
});

describe('Journeys 2–5 — create, persist, redirect, analytics', () => {
  it('creates a link, lists it after "refresh", redirects, and records the click', async () => {
    const { agent } = await newUser();
    const created = await createLink(agent, { destinationUrl: 'https://example.com/docs?x=1', title: 'Docs' });
    expect(created.status).toBe(201);
    const link = created.body.link;
    expect(link.code).toMatch(/^[a-z2-9]{7}$/);
    expect(link.shortUrl).toBe(`http://lp.test/${link.code}`);
    expect(link.safety.status).toBe('format_valid'); // no threat intel configured in tests

    // "Refresh": a brand-new request reads from the database.
    const list = await agent.get('/api/links');
    expect(list.body.links.map((l: any) => l.id)).toContain(link.id);

    const visit = await request(app).get(`/${link.code}`).set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1').set('Referer', 'https://www.twitter.com/some/post');
    expect(visit.status).toBe(302);
    expect(visit.headers.location).toBe('https://example.com/docs?x=1');
    expect(visit.headers['cache-control']).toContain('no-store');

    // Codes are case-insensitive.
    expect((await request(app).get(`/${link.code.toUpperCase()}`)).status).toBe(302);

    const stats = await agent.get(`/api/analytics/links/${link.id}?days=7`);
    expect(stats.status).toBe(200);
    expect(stats.body.totals.allTimeClicks).toBe(2);
    expect(stats.body.daily).toHaveLength(7);
    expect(stats.body.daily.at(-1).clicks).toBe(2);
    expect(stats.body.devices).toEqual(expect.arrayContaining([{ label: 'mobile', clicks: 1 }]));
    expect(stats.body.referrers).toEqual(expect.arrayContaining([{ label: 'twitter.com', clicks: 1 }]));
    expect(stats.body.unavailable.location).toMatch(/Not collected/);

    const detail = await agent.get(`/api/links/${link.id}`);
    expect(detail.body.link.clickCount).toBe(2);

    const overview = await agent.get('/api/analytics/overview?days=30&tz=Asia/Kolkata');
    expect(overview.status).toBe(200);
    expect(overview.body.totals.clicksInRange).toBe(2);
    expect(overview.body.links.total).toBe(1);
  });

  it('HEAD requests do not consume clicks', async () => {
    const { agent } = await newUser();
    const { body } = await createLink(agent, { destinationUrl: 'https://example.com', maxClicks: 1 });
    expect((await request(app).head(`/${body.link.code}`)).status).toBe(200);
    expect((await request(app).get(`/${body.link.code}`)).status).toBe(302);
  });

  it('supports custom aliases with collision and validation checks', async () => {
    const { agent } = await newUser();
    const ok = await createLink(agent, { destinationUrl: 'https://example.com', alias: 'Spring-Fest' });
    expect(ok.status).toBe(201);
    expect(ok.body.link.code).toBe('spring-fest');
    const clash = await createLink(agent, { destinationUrl: 'https://example.org', alias: 'SPRING-FEST' });
    expect(clash.status).toBe(409);
    for (const bad of ['ab', 'has space', 'bad/slash', '-start', 'api', 'dashboard', 'x'.repeat(40)]) {
      expect((await createLink(agent, { destinationUrl: 'https://example.com', alias: bad })).status, bad).toBe(400);
    }
  });

  it('only accepts http/https destinations', async () => {
    const { agent } = await newUser();
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'file:///etc/passwd', 'example.com', 'https://exa mple.com', '', 'http://lp.test/abc']) {
      expect((await createLink(agent, { destinationUrl: bad })).status, bad).toBe(400);
    }
  });
});

describe('Journey 6 — invalid, missing, expired, disabled', () => {
  it('returns the right error pages', async () => {
    const { agent } = await newUser();
    expect((await request(app).get('/zzzzzzz')).status).toBe(404);
    expect((await request(app).get('/%3Cscript%3E')).status).toBe(404);

    const { body } = await createLink(agent, { destinationUrl: 'https://example.com', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect((await request(app).get(`/${body.link.code}`)).status).toBe(302);
    await pool.query("UPDATE links SET expires_at = now() - interval '1 minute' WHERE id = $1", [body.link.id]);
    const expired = await request(app).get(`/${body.link.code}`);
    expect(expired.status).toBe(410);
    expect(expired.text).toContain('expired');
    expect((await agent.get(`/api/links/${body.link.id}`)).body.link.effectiveStatus).toBe('expired');

    const d = (await createLink(agent, { destinationUrl: 'https://example.com' })).body.link;
    expect((await agent.patch(`/api/links/${d.id}`).send({ status: 'disabled' })).status).toBe(200);
    const disabled = await request(app).get(`/${d.code}`);
    expect(disabled.status).toBe(410);
    expect(disabled.text).toContain('disabled');
    await agent.patch(`/api/links/${d.id}`).send({ status: 'active' });
    expect((await request(app).get(`/${d.code}`)).status).toBe(302);
  });

  it('rejects past expiry dates', async () => {
    const { agent } = await newUser();
    const r = await createLink(agent, { destinationUrl: 'https://example.com', expiresAt: '2001-01-01T00:00:00Z' });
    expect(r.status).toBe(400);
  });
});

describe('Journey 7 — password-protected links', () => {
  it('shows a form, rejects wrong passwords, accepts the right one, and never stores plaintext', async () => {
    const { agent } = await newUser();
    const { body } = await createLink(agent, { destinationUrl: 'https://example.com/secret', password: 'open-sesame' });
    expect(body.link.hasPassword).toBe(true);
    expect(JSON.stringify(body)).not.toContain('open-sesame');
    const { rows } = await pool.query('SELECT password_hash FROM links WHERE id = $1', [body.link.id]);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);

    const form = await request(app).get(`/${body.link.code}`);
    expect(form.status).toBe(200);
    expect(form.text).toContain('password-protected');
    const wrong = await request(app).post(`/${body.link.code}`).type('form').send({ password: 'wrong' });
    expect(wrong.status).toBe(401);
    expect(wrong.text).toContain('Incorrect password');
    const empty = await request(app).post(`/${body.link.code}`).type('form').send({});
    expect(empty.status).toBe(401);
    const right = await request(app).post(`/${body.link.code}`).type('form').send({ password: 'open-sesame' });
    expect(right.status).toBe(303);
    expect(right.headers.location).toBe('https://example.com/secret');
    // Only the successful unlock counted as a click.
    expect((await agent.get(`/api/links/${body.link.id}`)).body.link.clickCount).toBe(1);
  });

  it('rate-limits password guessing per link', async () => {
    const { agent } = await newUser();
    const { body } = await createLink(agent, { destinationUrl: 'https://example.com', password: 'correct-horse' });
    config.rateLimitDisabled = false;
    try {
      for (let i = 0; i < 5; i++) expect((await request(app).post(`/${body.link.code}`).type('form').send({ password: `guess${i}` })).status).toBe(401);
      expect((await request(app).post(`/${body.link.code}`).type('form').send({ password: 'correct-horse' })).status).toBe(429);
    } finally {
      config.rateLimitDisabled = true;
    }
  });
});

describe('Journey 8 — click limits', () => {
  it('stops exactly at the limit, including under concurrent load', async () => {
    const { agent } = await newUser();
    const { body } = await createLink(agent, { destinationUrl: 'https://example.com', maxClicks: 3 });
    const results = await Promise.all(Array.from({ length: 12 }, () => request(app).get(`/${body.link.code}`)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 302)).toHaveLength(3);
    expect(statuses.filter((s) => s === 410)).toHaveLength(9);
    const { rows } = await pool.query('SELECT click_count, (SELECT count(*)::int FROM click_events WHERE link_id = $1) AS events FROM links WHERE id = $1', [body.link.id]);
    expect(rows[0]).toEqual({ click_count: 3, events: 3 });
    const page = await request(app).get(`/${body.link.code}`);
    expect(page.text).toContain('click limit');
    expect((await agent.get(`/api/links/${body.link.id}`)).body.link.effectiveStatus).toBe('limit_reached');
    // Can't lower the limit below what was used; raising it re-opens the link.
    expect((await agent.patch(`/api/links/${body.link.id}`).send({ maxClicks: 2 })).status).toBe(400);
    expect((await agent.patch(`/api/links/${body.link.id}`).send({ maxClicks: 4 })).status).toBe(200);
    expect((await request(app).get(`/${body.link.code}`)).status).toBe(302);
    expect((await request(app).get(`/${body.link.code}`)).status).toBe(410);
  });
});

describe('Journey 9 — ownership', () => {
  it("prevents users from reading, editing or deleting another user's links, campaigns and tags", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const link = (await createLink(alice.agent, { destinationUrl: 'https://alice.example.com' })).body.link;
    const camp = (await alice.agent.post('/api/campaigns').send({ name: 'Alice launch' })).body.campaign;
    const tag = (await alice.agent.post('/api/tags').send({ name: 'private' })).body.tag;

    expect((await bob.agent.get(`/api/links/${link.id}`)).status).toBe(404);
    expect((await bob.agent.patch(`/api/links/${link.id}`).send({ destinationUrl: 'https://bob.example.com' })).status).toBe(404);
    expect((await bob.agent.patch(`/api/links/${link.id}`).send({ status: 'disabled' })).status).toBe(404);
    expect((await bob.agent.delete(`/api/links/${link.id}`)).status).toBe(404);
    expect((await bob.agent.get(`/api/analytics/links/${link.id}`)).status).toBe(404);
    expect((await bob.agent.post(`/api/links/${link.id}/recheck-safety`).send({})).status).toBe(404);
    expect((await bob.agent.get('/api/links')).body.links).toHaveLength(0);
    expect((await bob.agent.patch(`/api/campaigns/${camp.id}`).send({ name: 'hijack' })).status).toBe(404);
    expect((await bob.agent.delete(`/api/tags/${tag.id}`)).status).toBe(404);

    // Bob can't attach Alice's campaign/tag to his own link either.
    expect((await createLink(bob.agent, { destinationUrl: 'https://bob.example.com', campaignId: camp.id })).status).toBe(400);
    expect((await createLink(bob.agent, { destinationUrl: 'https://bob.example.com', tagIds: [tag.id] })).status).toBe(400);

    const still = await alice.agent.get(`/api/links/${link.id}`);
    expect(still.body.link.destinationUrl).toBe('https://alice.example.com/');
    expect(still.body.link.status).toBe('active');
  });
});

describe('Campaigns, tags, search and filters', () => {
  it('applies campaign UTM tags at redirect and attributes clicks', async () => {
    const { agent } = await newUser();
    const camp = (await agent.post('/api/campaigns').send({ name: 'Hackathon', utmSource: 'poster', utmMedium: 'qr', utmCampaign: 'hack26' })).body.campaign;
    const tag = (await agent.post('/api/tags').send({ name: 'Print', color: '#ff0000' })).body.tag;
    const { body } = await createLink(agent, { destinationUrl: 'https://example.com/?utm_source=keep', campaignId: camp.id, tagIds: [tag.id] });
    expect(body.link.campaign.name).toBe('Hackathon');
    expect(body.link.tags[0].name).toBe('Print');
    const visit = await request(app).get(`/${body.link.code}`);
    const loc = new URL(visit.headers.location);
    expect(loc.searchParams.get('utm_source')).toBe('keep'); // existing values are not overwritten
    expect(loc.searchParams.get('utm_medium')).toBe('qr');
    expect(loc.searchParams.get('utm_campaign')).toBe('hack26');
    const camps = (await agent.get('/api/campaigns')).body.campaigns;
    expect(camps[0]).toMatchObject({ name: 'Hackathon', linkCount: 1, totalClicks: 1 });

    await createLink(agent, { destinationUrl: 'https://other.example.org', title: 'Unrelated' });
    expect((await agent.get(`/api/links?tagId=${tag.id}`)).body.total).toBe(1);
    expect((await agent.get(`/api/links?campaignId=${camp.id}`)).body.total).toBe(1);
    expect((await agent.get('/api/links?search=other.example')).body.total).toBe(1);
    expect((await agent.get('/api/links?search=%25')).body.total).toBe(0); // LIKE wildcards are escaped
    expect((await agent.get('/api/links?status=disabled')).body.total).toBe(0);
    expect((await agent.post('/api/tags').send({ name: 'print' })).status).toBe(409);
  });
});

describe('Safety checks', () => {
  it('blocks blocklisted and private-network destinations', async () => {
    const { agent } = await newUser();
    for (const url of ['https://evil.example/login', 'https://sub.evil.example', 'http://127.0.0.1/admin', 'http://localhost:3000', 'http://192.168.1.1', 'http://[::1]/', 'http://2130706433/']) {
      const r = await createLink(agent, { destinationUrl: url });
      expect(r.status, url).toBe(422);
      expect(r.body.error.details.safety.status).toBe('blocked');
    }
    await pool.query("INSERT INTO blocked_domains (domain, reason) VALUES ('badsite.example', 'test')");
    expect((await createLink(agent, { destinationUrl: 'https://www.badsite.example' })).status).toBe(422);
  });

  it('requires confirmation for suspicious URLs and shows visitors a warning page', async () => {
    const { agent } = await newUser();
    const first = await createLink(agent, { destinationUrl: 'http://user:pw@8.8.8.8:8080/login' });
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('safety_confirmation_required');
    const codes = first.body.error.details.safety.reasons.map((r: any) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['ip_host', 'embedded_credentials', 'unusual_port', 'insecure_credentials_page']));
    const created = await createLink(agent, { destinationUrl: 'http://user:pw@8.8.8.8:8080/login', acknowledgeWarnings: true });
    expect(created.status).toBe(201);
    expect(created.body.link.safety.status).toBe('suspicious');
    const warn = await request(app).get(`/${created.body.link.code}`);
    expect(warn.status).toBe(200);
    expect(warn.text).toContain('Check before you continue');
    expect(warn.text).not.toContain('<script');
    const go = await request(app).post(`/${created.body.link.code}`).type('form').send({ confirm: '1' });
    expect(go.status).toBe(303);
  });

  it('never claims a URL is safe without threat intelligence', async () => {
    const { agent } = await newUser();
    const r = await agent.post('/api/safety/check').send({ url: 'https://example.com' });
    expect(r.body.safety.status).toBe('format_valid');
    expect(r.body.safety.threatIntel).toBe('not_configured');
    expect(JSON.stringify(r.body).toLowerCase()).not.toContain('"safe"');
  });

  it('re-checks the blocklist at redirect time', async () => {
    const { agent } = await newUser();
    const { body } = await createLink(agent, { destinationUrl: 'https://later-bad.example' });
    expect((await request(app).get(`/${body.link.code}`)).status).toBe(302);
    await pool.query("INSERT INTO blocked_domains (domain) VALUES ('later-bad.example')");
    expect((await request(app).get(`/${body.link.code}`)).status).toBe(403);
  });
});

describe('Robustness', () => {
  it('escapes HTML in error/password pages and handles malformed input', async () => {
    const { agent } = await newUser();
    expect((await agent.post('/api/links').set('Content-Type', 'application/json').send('{bad json')).status).toBe(400);
    expect((await agent.post('/api/links').send({ destinationUrl: 'https://example.com', unknownField: 1 })).status).toBe(400);
    expect((await agent.get('/api/links/not-a-uuid')).status).toBe(404);
    expect((await agent.get('/api/links?pageSize=1000')).status).toBe(400);
    const r = await agent.get('/api/nope');
    expect(r.status).toBe(404);
  });
});
