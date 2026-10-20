import express from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { notFound } from '../lib/errors.js';
import { requireAuth, uid } from '../middleware/auth.js';

/**
 * Every number here is computed from rows in click_events / links. Nothing is estimated or invented.
 * Metrics we deliberately do not collect are returned in `unavailable` so the UI can label them.
 */
export const analyticsRouter = express.Router();
analyticsRouter.use(requireAuth);

const rangeSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  tz: z.string().max(64).optional(),
});

const UNAVAILABLE = {
  location: 'Not collected — LinkPulse does not store IP addresses or look up visitor locations.',
  uniqueVisitors: 'Not tracked — counting unique people would require storing identifiers about visitors.',
};

async function resolveTz(tz?: string) {
  if (!tz) return 'UTC';
  // Unknown/unsupported zone names (some browsers report e.g. "Etc/Unknown") fall back to UTC;
  // the response's range.tz tells the client which zone was actually used.
  const { rowCount } = await query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [tz]);
  return rowCount ? tz : 'UTC';
}

/** Shared breakdown queries. `scope` is a SQL condition on click_events alias e; params[0..] already bound. */
async function breakdowns(scope: string, params: unknown[], days: number, tz: string) {
  const n = params.length;
  const rangeParams = [...params, days, tz];
  const inRange = `${scope} AND e.clicked_at >= (date_trunc('day', now() AT TIME ZONE $${n + 2}) - make_interval(days => $${n + 1} - 1)) AT TIME ZONE $${n + 2}`;

  const [daily, devices, referrers, browsers, oses, totals] = await Promise.all([
    query(
      `WITH d AS (
         SELECT generate_series(date_trunc('day', now() AT TIME ZONE $${n + 2}) - make_interval(days => $${n + 1} - 1),
                                date_trunc('day', now() AT TIME ZONE $${n + 2}), interval '1 day')::date AS day)
       SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
              count(e.id)::int AS clicks,
              count(e.id) FILTER (WHERE e.device_type <> 'bot')::int AS human_clicks
         FROM d LEFT JOIN click_events e ON (e.clicked_at AT TIME ZONE $${n + 2})::date = d.day AND ${scope}
        GROUP BY d.day ORDER BY d.day`,
      rangeParams,
    ),
    query(`SELECT e.device_type AS label, count(*)::int AS clicks FROM click_events e WHERE ${inRange} GROUP BY 1 ORDER BY 2 DESC`, rangeParams),
    query(`SELECT COALESCE(e.referrer_host, 'Direct / unknown') AS label, count(*)::int AS clicks FROM click_events e WHERE ${inRange} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, rangeParams),
    query(`SELECT COALESCE(e.browser, 'Unknown') AS label, count(*)::int AS clicks FROM click_events e WHERE ${inRange} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, rangeParams),
    query(`SELECT COALESCE(e.os, 'Unknown') AS label, count(*)::int AS clicks FROM click_events e WHERE ${inRange} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, rangeParams),
    query(
      `SELECT count(*)::int AS all_time,
              count(*) FILTER (WHERE ${inRange.replace(`${scope} AND `, '')})::int AS in_range,
              count(*) FILTER (WHERE e.device_type = 'bot' AND ${inRange.replace(`${scope} AND `, '')})::int AS bots_in_range,
              max(e.clicked_at) AS last_click
         FROM click_events e WHERE ${scope}`,
      rangeParams,
    ),
  ]);
  return {
    totals: {
      allTimeClicks: totals.rows[0].all_time,
      clicksInRange: totals.rows[0].in_range,
      botClicksInRange: totals.rows[0].bots_in_range,
      lastClickAt: totals.rows[0].last_click,
    },
    daily: daily.rows,
    devices: devices.rows,
    referrers: referrers.rows,
    browsers: browsers.rows,
    operatingSystems: oses.rows,
  };
}

analyticsRouter.get('/overview', async (req, res) => {
  const q = rangeSchema.parse(req.query);
  const days = q.days ?? 30;
  const tz = await resolveTz(q.tz);
  const userId = uid(req);
  const scope = 'e.link_id IN (SELECT id FROM links WHERE user_id = $1)';
  const [b, linkStats, topLinks, campaigns] = await Promise.all([
    breakdowns(scope, [userId], days, tz),
    query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'active' AND safety_status <> 'blocked' AND (expires_at IS NULL OR expires_at > now())
                                 AND (max_clicks IS NULL OR click_count < max_clicks))::int AS active,
              count(*) FILTER (WHERE safety_status = 'suspicious')::int AS suspicious
         FROM links WHERE user_id = $1`, [userId]),
    query(
      `SELECT l.id, l.code, l.title, l.destination_url, count(e.id)::int AS clicks
         FROM links l JOIN click_events e ON e.link_id = l.id
        WHERE l.user_id = $1 AND e.clicked_at >= now() - make_interval(days => $2)
        GROUP BY l.id ORDER BY clicks DESC LIMIT 5`, [userId, days]),
    query(
      `SELECT COALESCE(c.name, 'No campaign') AS label, count(e.id)::int AS clicks
         FROM click_events e JOIN links l ON l.id = e.link_id LEFT JOIN campaigns c ON c.id = e.campaign_id
        WHERE l.user_id = $1 AND e.clicked_at >= now() - make_interval(days => $2)
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [userId, days]),
  ]);
  res.json({
    range: { days, tz },
    links: linkStats.rows[0],
    ...b,
    topLinks: topLinks.rows,
    campaigns: campaigns.rows,
    unavailable: UNAVAILABLE,
  });
});

analyticsRouter.get('/links/:id', async (req, res) => {
  const q = rangeSchema.parse(req.query);
  const days = q.days ?? 30;
  const tz = await resolveTz(q.tz);
  const id = req.params.id;
  if (!z.string().uuid().safeParse(id).success) throw notFound('Link not found.');
  const own = await query('SELECT id FROM links WHERE id = $1 AND user_id = $2', [id, uid(req)]);
  if (!own.rowCount) throw notFound('Link not found.');
  const b = await breakdowns('e.link_id = $1', [id], days, tz);
  const recent = await query(
    `SELECT clicked_at, device_type, browser, os, COALESCE(referrer_host, 'Direct / unknown') AS referrer
       FROM click_events WHERE link_id = $1 ORDER BY clicked_at DESC LIMIT 10`, [id]);
  res.json({ range: { days, tz }, ...b, recentClicks: recent.rows, unavailable: UNAVAILABLE });
});
