import type { Deps } from '../_shared/deps.ts';
import { cors, fail, json, pgError, requireUser } from '../_shared/http.ts';
import { checkUrlSafety, validateDestination } from '../_shared/safety.ts';

/**
 * POST /functions/v1/update-link  { id, destinationUrl?, password? (string = set, null = remove), acknowledgeWarnings? }
 * Only for the two sensitive fields. Title/status/expiry/limit/campaign are updated directly with
 * supabase-js (RLS + column grants + the links_guard trigger enforce the rules).
 */
export function updateLinkHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const h = cors(deps, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.', h);
    const userId = await requireUser(deps, req);
    if (!userId) return fail(401, 'unauthorized', 'Please log in.', h);
    // Each call can run a bcrypt hash and a safety check, so cap them per user.
    if (!(await deps.sql`SELECT lp_rate_limit_hit(${'update:' + userId}, 60, '1 hour') AS ok`)[0].ok) {
      return fail(429, 'rate_limited', 'Too many changes. Try again later.', h);
    }
    let b: any;
    try { b = await req.json(); } catch { return fail(400, 'bad_json', 'Request body is not valid JSON.', h); }
    if (typeof b?.id !== 'string') return fail(400, 'bad_request', 'Link id is required.', h);

    const [owned] = await deps.sql`SELECT id FROM links WHERE id = ${b.id}::uuid AND user_id = ${userId}`.catch(() => []);
    if (!owned) return fail(404, 'not_found', 'Link not found.', h);

    let dest: string | null = null;
    let safety = null;
    if (b.destinationUrl !== undefined) {
      const own = deps.env.shortBaseUrl ? new URL(deps.env.shortBaseUrl).host : undefined;
      const v = validateDestination(b.destinationUrl, own);
      if (!v.ok) return fail(400, 'bad_request', v.error, h, [{ field: 'destinationUrl', message: v.error }]);
      safety = await checkUrlSafety(deps.sql, v.url, deps.env);
      if (safety.status === 'blocked') return fail(422, 'unprocessable', 'This destination is blocked by LinkPulse safety checks.', h, { safety });
      if (safety.status === 'suspicious' && b.acknowledgeWarnings !== true) {
        return fail(409, 'safety_confirmation_required', 'This destination looks suspicious. Review the warnings and confirm.', h, { safety });
      }
      dest = v.url.href;
    }
    const setPw = b.password !== undefined;
    if (setPw && b.password !== null && (typeof b.password !== 'string' || b.password.length < 4 || b.password.length > 128)) {
      return fail(400, 'bad_request', 'Link password must be 4–128 characters.', h);
    }
    try {
      const [link] = await deps.sql`
        SELECT id, code, destination_url, safety_status, (password_hash IS NOT NULL) AS has_password
          FROM lp_update_link_secure(${userId}, ${b.id}::uuid, ${dest}, ${safety?.status ?? null},
                                     ${safety ? deps.sql.json(safety.reasons as any) : null}, ${setPw}, ${setPw ? b.password : null})`;
      return json({ link, safety }, 200, h);
    } catch (e) {
      return pgError(e, h);
    }
  };
}
