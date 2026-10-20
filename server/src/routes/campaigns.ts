import express from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { clearLinkCache } from '../lib/linkCache.js';
import { conflict, notFound } from '../lib/errors.js';
import { requireAuth, uid } from '../middleware/auth.js';

export const campaignsRouter = express.Router();
campaignsRouter.use(requireAuth);

const utm = z.string().trim().max(100).regex(/^[\w.\-+ ]*$/, 'UTM values may contain letters, numbers, spaces and . - _ +').optional().nullable();
const base = {
  name: z.string().trim().min(1, 'Campaign name is required.').max(80),
  description: z.string().trim().max(500).optional().nullable(),
  utmSource: utm, utmMedium: utm, utmCampaign: utm,
};
const createSchema = z.object(base).strict();
const updateSchema = z.object({ ...base, name: base.name.optional() }).strict();
const idSchema = z.string().uuid();

const serialize = (r: any) => ({
  id: r.id, name: r.name, description: r.description,
  utmSource: r.utm_source, utmMedium: r.utm_medium, utmCampaign: r.utm_campaign,
  linkCount: r.link_count ?? 0, totalClicks: r.total_clicks ?? 0, createdAt: r.created_at, updatedAt: r.updated_at,
});

const SELECT = `SELECT c.*, (SELECT count(*)::int FROM links l WHERE l.campaign_id = c.id) AS link_count,
                       (SELECT count(*)::int FROM click_events e WHERE e.campaign_id = c.id) AS total_clicks
                  FROM campaigns c`;

const dup = (e: any) => { if (e.code === '23505') throw conflict('You already have a campaign with that name.'); throw e; };

campaignsRouter.get('/', async (req, res) => {
  const { rows } = await query(`${SELECT} WHERE c.user_id = $1 ORDER BY c.created_at DESC`, [uid(req)]);
  res.json({ campaigns: rows.map(serialize) });
});

campaignsRouter.post('/', async (req, res) => {
  const b = createSchema.parse(req.body);
  const { rows } = await query(
    `INSERT INTO campaigns (user_id, name, description, utm_source, utm_medium, utm_campaign) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [uid(req), b.name, b.description || null, b.utmSource || null, b.utmMedium || null, b.utmCampaign || null],
  ).catch(dup);
  res.status(201).json({ campaign: serialize(rows[0]) });
});

campaignsRouter.patch('/:id', async (req, res) => {
  if (!idSchema.safeParse(req.params.id).success) throw notFound('Campaign not found.');
  const b = updateSchema.parse(req.body);
  const map: Record<string, string> = { name: 'name', description: 'description', utmSource: 'utm_source', utmMedium: 'utm_medium', utmCampaign: 'utm_campaign' };
  const sets: string[] = []; const params: unknown[] = [];
  for (const [k, col] of Object.entries(map)) {
    const v = (b as any)[k];
    if (v !== undefined) { params.push(v === '' ? null : v); sets.push(`${col} = $${params.length}`); }
  }
  params.push(req.params.id, uid(req));
  const { rowCount } = await query(
    `UPDATE campaigns SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $${params.length - 1} AND user_id = $${params.length}`, params,
  ).catch(dup);
  if (!rowCount) throw notFound('Campaign not found.');
  clearLinkCache(); // links carry their campaign's UTM tags
  const { rows } = await query(`${SELECT} WHERE c.id = $1 AND c.user_id = $2`, [req.params.id, uid(req)]);
  res.json({ campaign: serialize(rows[0]) });
});

campaignsRouter.delete('/:id', async (req, res) => {
  if (!idSchema.safeParse(req.params.id).success) throw notFound('Campaign not found.');
  const { rowCount } = await query('DELETE FROM campaigns WHERE id = $1 AND user_id = $2', [req.params.id, uid(req)]);
  if (!rowCount) throw notFound('Campaign not found.');
  clearLinkCache();
  res.status(204).end();
});
