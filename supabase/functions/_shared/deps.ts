import postgres from 'npm:postgres@3.4.5';
export type Sql = ReturnType<typeof postgres>;

/** Everything a handler needs from the outside world — injected so tests can run against a local DB. */
export interface Deps {
  sql: Sql;
  /** Resolve a bearer token to a user id (null if invalid). */
  getUserId: (token: string) => Promise<string | null>;
  env: { appOrigin: string; shortBaseUrl: string; blocklist: string[]; safeBrowsingKey?: string };
}

/** Production wiring for Supabase Edge Functions. SUPABASE_DB_URL / SUPABASE_URL / keys are provided by Supabase. */
export async function productionDeps(): Promise<Deps> {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  return {
    sql: postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 }),
    getUserId: async (token) => {
      const { data, error } = await supabase.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
    env: {
      appOrigin: (Deno.env.get('APP_ORIGIN') ?? '').replace(/\/$/, ''),
      shortBaseUrl: (Deno.env.get('SHORT_BASE_URL') ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/r`).replace(/\/$/, ''),
      blocklist: (Deno.env.get('BLOCKLIST_DOMAINS') ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
      safeBrowsingKey: Deno.env.get('GOOGLE_SAFE_BROWSING_API_KEY') || undefined,
    },
  };
}
