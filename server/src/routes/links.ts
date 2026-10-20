import express from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { hashPassword } from '../lib/auth.js';
import { invalidateLink } from '../lib/linkCache.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { checkUrlSafety, type SafetyResult } from '../lib/safety.js';
import { generateCode, validateAlias } from '../lib/shortcode.js';
import { validateDestination } from '../lib/url.js';
import { requireAuth, uid } from '../middleware/auth.js';
import { createLinkLimiter, requireVerifiedEmail } from '../middleware/security.js';
import type pg from 'pg';

export const linksRouter = express.Router();
linksRouter.use(requireAuth);

const uuid = z.string().uuid({ message: 'Invalid id.' });
const optionalDate = z
  .union([z.string().datetime({ offset: true, message: 'Expiry must be an ISO date-time.' }), z.null()])
  .optional();

const createSchema = z.object({
  destinationUrl: z.string().max(4096),
  alias: z.string().max(64).optional().nullable(),
  title: z.string().trim().max(120).optional().nullable(),
  expiresAt: optionalDate,
  password: z.string().min(4, 'Link password must be at least 4 characters.').max(128).optional().nullable(),
  maxClicks: z.number().int().min(1, 'Click limit must be at least 1.').max(10_000_000).optional().nullable(),
  campaignId: uuid.optional().nullable(),
  tagIds: z.array(uuid).max(20).optional(),
  acknowledgeWarnings: z.boolean().optional(),
}).strict();

const updateSchema = z.object({
  destinationUrl: z.string().max(4096).optional(),
  title: z.string().trim().max(120).optional().nullable(),
  status: z.enum(['active', 'disabled']).optional(),
  expiresAt: optionalDate,
  password: z.string().min(4, 'Link password must be at least 4 characters.').max(128).optional().nullable(),
  maxClicks: z.number().int().min(1).max(10_000_000).optional().nullable(),
  campaignId: uuid.optional().nullable(),
  tagIds: z.array(uuid).max(20).optional(),
  acknowledgeWarnings: z.boolean().optional(),
}).strict();

const LINK_SELECT = `
  SELECT l.id, l.code, l.destination_url, l.title, l.is_custom_alias, l.status, l.expires_at,
         (l.password_hash IS NOT NULL) AS has_password, l.max_clicks, l.click_count, l.campaign_id,
         c.name AS campaign_name, l.safety_status, l.safety_reasons, l.safety_checked_at,
         l.last_clicked_at, l.created_at, l.updated_at,
         COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY t.name)
                     FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = l.id), '[]') AS tags
    FROM links l LEFT JOIN campaigns c ON c.id = l.campaign_id`;

export function effectiveStatus(row: { status: string; expires_at: Date | null; max_clicks: number | null; click_count: number; safety_status: string }) {
  if (row.safety_status === 'blocked') return 'blocked';
  if (row.status === 'disabled') return 'disabled';
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  if (row.max_clicks !== null && row.click_count >= row.max_clicks) return 'limit_reached';
  return 'active';
}

export function serializeLink(r: any) {
  return {
    id: r.id,
    code: r.code,
    shortUrl: `${config.shortBaseUrl}/${r.code}`,
    destinationUrl: r.destination_url,
    title: r.title,
    isCustomAlias: r.is_custom_alias,
    status: r.status,
    effectiveStatus: effectiveStatus(r),
    expiresAt: r.expires_at,
    hasPassword: r.has_password,
    maxClicks: r.max_clicks,
    clickCount: r.click_count,
    campaign: r.campaign_id ? { id: r.campaign_id, name: r.campaign_name } : null,
    tags: r.tags,
    safety: { status: r.safety_status, reasons: r.safety_reasons, checkedAt: r.safety_checked_at },
    lastClickedAt: r.last_clicked_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function getOwnedLink(userId: string, id: string) {
  if (!uuid.safeParse(id).success) throw notFound('Link not found.');
  // Ownership is part of the WHERE clause: another user's link is indistinguishable from a missing one.
  const { rows } = await query(`${LINK_SELECT} WHERE l.id = $1 AND l.user_id = $2`, [id, userId]);
  if (!rows[0]) throw notFound('Link not found.');
  return rows[0];
}

async function assertOwnedCampaign(client: pg.PoolClient, userId: string, campaignId: string | null | undefined) {
  if (!campaignId) return;
  const { rowCount } = await client.query('SELECT 1 FROM campaigns WHERE id = $1 AND user_id = $2', [campaignId, userId]);
  if (!rowCount) throw badRequest('Campaign not found.');
}

async function setTags(client: pg.PoolClient, userId: string, linkId: string, tagIds: string[]) {
  const unique = [...new Set(tagIds)];
  if (unique.length) {
    const { rowCount } = await client.query('SELECT 1 FROM tags WHERE id = ANY($1) AND user_id = $2', [unique, userId]);
    if (rowCount !== unique.length) throw badRequest('One or more tags were not found.');
  }
  await client.query('DELETE FROM link_tags WHERE link_id = $1', [linkId]);
  if (unique.length) {
    await client.query('INSERT INTO link_tags (link_id, tag_id) SELECT $1, unnest($2::uuid[])', [linkId, unique]);
  }
}

function parseExpiry(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const d = new Date(v);
  if (d.getTime() <= Date.now()) throw badRequest('Expiry date must be in the future.');
  return d;
}

/** Validate + safety-check a destination. Blocked → 422; suspicious requires explicit acknowledgement. */
async function vetDestination(raw: string, acknowledge: boolean | undefined) {
  const v = validateDestination(raw);
  if (!v.ok) throw badRequest(v.error, [{ field: 'destinationUrl', message: v.error }]);
  const safety = await checkUrlSafety(v.url);
  if (safety.status === 'blocked') {
    throw unprocessable('This destination is blocked by LinkPulse safety checks.', { safety });
  }
  if (safety.status === 'suspicious' && !acknowledge) {
    throw conflictWithSafety(safety);
  }
  return { href: v.href, safety };
}

function conflictWithSafety(safety: SafetyResult) {
  const e = conflict('This destination looks suspicious. Review the warnings and confirm to create the link anyway.');
  e.code = 'safety_confirmation_required';
  e.details = { safety };
  return e;
}

async function recordSafety(client: pg.PoolClient, linkId: string, href: string, s: SafetyResult) {
  await client.query('INSERT INTO safety_checks (link_id, url, status, reasons, providers) VALUES ($1, $2, $3, $4, $5)',
    [linkId, href, s.status, JSON.stringify(s.reasons), s.providers]);
}

// ── GET /api/links ─────────────────────────────────────────────────
const listSchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(['all', 'active', 'disabled', 'expired', 'limit_reached', 'blocked']).optional(),
  safety: z.enum(['format_valid', 'no_known_issue', 'suspicious', 'blocked']).optional(),
  campaignId: uuid.optional(),
  tagId: uuid.optional(),
  sort: z.enum(['newest', 'oldest', 'most_clicks']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

linksRouter.get('/', async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = ['l.user_id = $1'];
  const params: unknown[] = [uid(req)];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (q.search) {
    const s = p(`%${q.search.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    where.push(`(l.code ILIKE ${s} OR l.destination_url ILIKE ${s} OR l.title ILIKE ${s})`);
  }
  switch (q.status) {
    case 'active': where.push(`l.status = 'active' AND l.safety_status <> 'blocked' AND (l.expires_at IS NULL OR l.expires_at > now()) AND (l.max_clicks IS NULL OR l.click_count < l.max_clicks)`); break;
    case 'disabled': where.push(`l.status = 'disabled'`); break;
    case 'expired': where.push(`l.expires_at IS NOT NULL AND l.expires_at <= now()`); break;
    case 'limit_reached': where.push(`l.max_clicks IS NOT NULL AND l.click_count >= l.max_clicks`); break;
    case 'blocked': where.push(`l.safety_status = 'blocked'`); break;
  }
  if (q.safety) where.push(`l.safety_status = ${p(q.safety)}`);
  if (q.campaignId) where.push(`l.campaign_id = ${p(q.campaignId)}`);
  if (q.tagId) where.push(`EXISTS (SELECT 1 FROM link_tags lt WHERE lt.link_id = l.id AND lt.tag_id = ${p(q.tagId)})`);

  const order = q.sort === 'oldest' ? 'l.created_at ASC' : q.sort === 'most_clicks' ? 'l.click_count DESC, l.created_at DESC' : 'l.created_at DESC';
  const pageSize = q.pageSize ?? 20;
  const page = q.page ?? 1;
  const whereSql = where.join(' AND ');
  const total = Number((await query(`SELECT count(*) FROM links l WHERE ${whereSql}`, params)).rows[0].count);
  const { rows } = await query(`${LINK_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params);
  res.json({ links: rows.map(serializeLink), total, page, pageSize });
});

// ── POST /api/links ────────────────────────────────────────────────
linksRouter.post('/', requireVerifiedEmail, createLinkLimiter, async (req, res) => {
  const body = createSchema.parse(req.body);
  const userId = uid(req);
  const expiresAt = parseExpiry(body.expiresAt ?? null) ?? null;

  let alias: string | null = null;
  if (body.alias && body.alias.trim()) {
    const a = validateAlias(body.alias);
    if (!a.ok) throw badRequest(a.error, [{ field: 'alias', message: a.error }]);
    alias = a.alias;
  }
  const { href, safety } = await vetDestination(body.destinationUrl, body.acknowledgeWarnings);
  const passwordHash = body.password ? await hashPassword(body.password) : null;

  const linkId = await tx(async (client) => {
    await assertOwnedCampaign(client, userId, body.campaignId);
    const insert = (code: string, isCustom: boolean) => client.query(
      `INSERT INTO links (user_id, code, destination_url, title, is_custom_alias, expires_at, password_hash, max_clicks,
                          campaign_id, safety_status, safety_reasons, safety_checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now()) RETURNING id`,
      [userId, code, href, body.title || null, isCustom, expiresAt, passwordHash, body.maxClicks ?? null,
        body.campaignId ?? null, safety.status, JSON.stringify(safety.reasons)],
    );

    let id: string | undefined;
    if (alias) {
      try {
        id = (await insert(alias, true)).rows[0].id;
      } catch (e: any) {
        if (e.code === '23505') throw conflict(`The alias "${alias}" is already taken. Please choose another.`);
        throw e;
      }
    } else {
      // Random code with collision detection: on a unique-constraint clash, roll back to the savepoint and retry.
      for (let attempt = 0; attempt < 5 && !id; attempt++) {
        await client.query('SAVEPOINT gen');
        try {
          id = (await insert(generateCode(), false)).rows[0].id;
        } catch (e: any) {
          if (e.code !== '23505') throw e;
          await client.query('ROLLBACK TO SAVEPOINT gen');
        }
      }
      if (!id) throw new Error('Could not generate a unique short code after 5 attempts.');
    }
    if (body.tagIds?.length) await setTags(client, userId, id!, body.tagIds);
    await recordSafety(client, id!, href, safety);
    return id!;
  });

  res.status(201).json({ link: serializeLink(await getOwnedLink(userId, linkId)) });
});

// ── GET /api/links/:id ─────────────────────────────────────────────
linksRouter.get('/:id', async (req, res) => {
  res.json({ link: serializeLink(await getOwnedLink(uid(req), req.params.id)) });
});

// ── PATCH /api/links/:id ───────────────────────────────────────────
linksRouter.patch('/:id', async (req, res) => {
  const body = updateSchema.parse(req.body);
  const userId = uid(req);
  const existing = await getOwnedLink(userId, req.params.id);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };

  let safety: SafetyResult | null = null;
  let href: string | null = null;
  if (body.destinationUrl !== undefined && body.destinationUrl.trim() !== existing.destination_url) {
    ({ href, safety } = await vetDestination(body.destinationUrl, body.acknowledgeWarnings));
    set('destination_url', href);
    set('safety_status', safety.status);
    set('safety_reasons', JSON.stringify(safety.reasons));
    sets.push('safety_checked_at = now()');
  }
  if (body.title !== undefined) set('title', body.title || null);
  if (body.status !== undefined) set('status', body.status);
  if (body.expiresAt !== undefined) set('expires_at', parseExpiry(body.expiresAt));
  if (body.password !== undefined) set('password_hash', body.password ? await hashPassword(body.password) : null);
  if (body.maxClicks !== undefined) {
    if (body.maxClicks !== null && body.maxClicks < existing.click_count) {
      throw badRequest(`Click limit can't be lower than the clicks already used (${existing.click_count}).`);
    }
    set('max_clicks', body.maxClicks);
  }
  if (body.campaignId !== undefined) set('campaign_id', body.campaignId);

  await tx(async (client) => {
    if (body.campaignId) await assertOwnedCampaign(client, userId, body.campaignId);
    if (sets.length) {
      params.push(existing.id, userId);
      await client.query(
        `UPDATE links SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length - 1} AND user_id = $${params.length}`,
        params,
      );
    }
    if (body.tagIds !== undefined) await setTags(client, userId, existing.id, body.tagIds);
    if (safety && href) await recordSafety(client, existing.id, href, safety);
  });
  invalidateLink(existing.code); // visitors must see the change immediately, not after the cache TTL
  res.json({ link: serializeLink(await getOwnedLink(userId, existing.id)) });
});

// ── DELETE /api/links/:id ──────────────────────────────────────────
linksRouter.delete('/:id', async (req, res) => {
  const link = await getOwnedLink(uid(req), req.params.id);
  await query('DELETE FROM links WHERE id = $1 AND user_id = $2', [link.id, uid(req)]);
  invalidateLink(link.code);
  res.status(204).end();
});

// ── POST /api/links/:id/recheck-safety ─────────────────────────────
linksRouter.post('/:id/recheck-safety', async (req, res) => {
  const userId = uid(req);
  const link = await getOwnedLink(userId, req.params.id);
  const v = validateDestination(link.destination_url);
  if (!v.ok) throw badRequest(v.error);
  const safety = await checkUrlSafety(v.url);
  await tx(async (client) => {
    await client.query(
      `UPDATE links SET safety_status = $1, safety_reasons = $2, safety_checked_at = now(), updated_at = now() WHERE id = $3 AND user_id = $4`,
      [safety.status, JSON.stringify(safety.reasons), link.id, userId],
    );
    await recordSafety(client, link.id, v.href, safety);
  });
  invalidateLink(link.code);
  res.json({ link: serializeLink(await getOwnedLink(userId, link.id)), safety });
});
