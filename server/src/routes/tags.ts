import express from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { requireAuth, uid } from '../middleware/auth.js';

export const tagsRouter = express.Router();
tagsRouter.use(requireAuth);

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #6366f1.');
const createSchema = z.object({ name: z.string().trim().min(1, 'Tag name is required.').max(40), color: color.optional() }).strict();
const updateSchema = z.object({ name: z.string().trim().min(1).max(40).optional(), color: color.optional() }).strict();
const idSchema = z.string().uuid();
const serialize = (r: any) => ({ id: r.id, name: r.name, color: r.color, linkCount: r.link_count ?? 0, createdAt: r.created_at });
const dup = (e: any) => { if (e.code === '23505') throw conflict('You already have a tag with that name.'); throw e; };

tagsRouter.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT t.*, (SELECT count(*)::int FROM link_tags lt WHERE lt.tag_id = t.id) AS link_count
       FROM tags t WHERE t.user_id = $1 ORDER BY lower(t.name)`, [uid(req)]);
  res.json({ tags: rows.map(serialize) });
});

tagsRouter.post('/', async (req, res) => {
  const b = createSchema.parse(req.body);
  const { rows } = await query('INSERT INTO tags (user_id, name, color) VALUES ($1, $2, COALESCE($3, \'#6366f1\')) RETURNING *',
    [uid(req), b.name, b.color ?? null]).catch(dup);
  res.status(201).json({ tag: serialize(rows[0]) });
});

tagsRouter.patch('/:id', async (req, res) => {
  if (!idSchema.safeParse(req.params.id).success) throw notFound('Tag not found.');
  const b = updateSchema.parse(req.body);
  const { rows } = await query(
    `UPDATE tags SET name = COALESCE($1, name), color = COALESCE($2, color) WHERE id = $3 AND user_id = $4 RETURNING *`,
    [b.name ?? null, b.color ?? null, req.params.id, uid(req)]).catch(dup);
  if (!rows[0]) throw notFound('Tag not found.');
  res.json({ tag: serialize(rows[0]) });
});

tagsRouter.delete('/:id', async (req, res) => {
  if (!idSchema.safeParse(req.params.id).success) throw notFound('Tag not found.');
  const { rowCount } = await query('DELETE FROM tags WHERE id = $1 AND user_id = $2', [req.params.id, uid(req)]);
  if (!rowCount) throw notFound('Tag not found.');
  res.status(204).end();
});
