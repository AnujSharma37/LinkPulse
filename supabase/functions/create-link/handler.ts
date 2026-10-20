import type { Deps } from '../_shared/deps.ts';
import { cors, fail, json, pgError, requireUser } from '../_shared/http.ts';
import { checkUrlSafety, validateAlias, validateDestination } from '../_shared/safety.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /functions/v1/create-link   (Authorization: Bearer <user access token>)
 * Body: { destinationUrl, alias?, title?, expiresAt?, password?, maxClicks?, campaignId?, tagIds?, acknowledgeWarnings? }
 * Same contract and error codes as POST /api/links in the Node API.
 */
export function createLinkHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const h = cors(deps, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.', h);
    const userId = await requireUser(deps, req);
    if (!userId) return fail(401, 'unauthorized', 'Please log in.', h);
    if (!(await deps.sql`SELECT lp_rate_limit_hit(${'create:' + userId}, 100, '1 hour') AS ok`)[0].ok) {
      return fail(429, 'rate_limited', 'You have created too many links this hour. Try again later.', h);
    }

    let b: any;
    try { b = await req.json(); } catch { return fail(400, 'bad_json', 'Request body is not valid JSON.', h); }
    if (!b || typeof b !== 'object') return fail(400, 'bad_request', 'Invalid body.', h);

    const own = deps.env.shortBaseUrl ? new URL(deps.env.shortBaseUrl).host : undefined;
    const v = validateDestination(b.destinationUrl, own);
    if (!v.ok) return fail(400, 'bad_request', v.error, h, [{ field: 'destinationUrl', message: v.error }]);
    let alias: string | null = null;
    if (typeof b.alias === 'string' && b.alias.trim()) {
      const a = validateAlias(b.alias);
      if (!a.ok) return fail(400, 'bad_request', a.error, h, [{ field: 'alias', message: a.error }]);
      alias = a.alias;
    }
    if (b.title != null && (typeof b.title !== 'string' || b.title.length > 120)) return fail(400, 'bad_request', 'Title must be at most 120 characters.', h);
    let expires: Date | null = null;
    if (b.expiresAt != null) {
      expires = new Date(b.expiresAt);
      if (isNaN(expires.getTime())) return fail(400, 'bad_request', 'Expiry must be an ISO date-time.', h);
    }
    if (b.password != null && (typeof b.password !== 'string' || b.password.length < 4 || b.password.length > 128)) {
      return fail(400, 'bad_request', 'Link password must be 4–128 characters.', h);
    }
    if (b.maxClicks != null && (!Number.isInteger(b.maxClicks) || b.maxClicks < 1 || b.maxClicks > 10_000_000)) {
      return fail(400, 'bad_request', 'Click limit must be a whole number of at least 1.', h);
    }
    if (b.campaignId != null && !UUID.test(String(b.campaignId))) return fail(400, 'bad_request', 'Campaign not found.', h);
    const tagIds: string[] = Array.isArray(b.tagIds) ? b.tagIds : [];
    if (tagIds.length > 20 || tagIds.some((t) => !UUID.test(String(t)))) return fail(400, 'bad_request', 'Invalid tags.', h);

    const safety = await checkUrlSafety(deps.sql, v.url, deps.env);
    if (safety.status === 'blocked') return fail(422, 'unprocessable', 'This destination is blocked by LinkPulse safety checks.', h, { safety });
    if (safety.status === 'suspicious' && b.acknowledgeWarnings !== true) {
      return fail(409, 'safety_confirmation_required', 'This destination looks suspicious. Review the warnings and confirm to create the link anyway.', h, { safety });
    }

    try {
      const [link] = await deps.sql`
        SELECT id, code, destination_url, title, status, expires_at, max_clicks, click_count, campaign_id, safety_status, safety_reasons, created_at
          FROM lp_create_link(${userId}, ${v.url.href}, ${alias}, ${b.title ?? null}, ${expires}, ${b.password ?? null},
                              ${b.maxClicks ?? null}, ${b.campaignId ?? null}, ${tagIds}::uuid[], ${safety.status},
                              ${deps.sql.json(safety.reasons as any)}, ${safety.providers})`;
      return json({ link: { ...link, shortUrl: `${deps.env.shortBaseUrl}/${link.code}`, hasPassword: b.password != null }, safety }, 201, h);
    } catch (e) {
      return pgError(e, h);
    }
  };
}
