import type { Deps } from './deps.ts';

export function cors(deps: Deps, _req: Request): Record<string, string> {
  // Only the configured web app may read responses. If APP_ORIGIN is unset, send no allow-origin header at all
  // (never the literal "null", which sandboxed iframes and file:// pages can match).
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (deps.env.appOrigin) headers['Access-Control-Allow-Origin'] = deps.env.appOrigin;
  return headers;
}

export function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
export const fail = (status: number, code: string, message: string, headers: Record<string, string>, details?: unknown) =>
  json({ error: { code, message, details } }, status, headers);

export async function requireUser(deps: Deps, req: Request): Promise<string | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return token ? deps.getUserId(token) : null;
}

/** Map Postgres errors raised by our SQL functions to HTTP responses without leaking internals. */
export function pgError(e: any, headers: Record<string, string>) {
  if (e?.code === '23505') return fail(409, 'conflict', e.message?.replace(/^.*?(The alias)/, '$1') ?? 'Already exists.', headers);
  if (e?.code === '22023') return fail(400, 'bad_request', e.message, headers);
  if (e?.code === 'P0002') return fail(404, 'not_found', 'Link not found.', headers);
  console.error(e);
  return fail(500, 'internal', 'Something went wrong on our side. Please try again.', headers);
}
