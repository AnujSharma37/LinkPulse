import { productionDeps } from '../_shared/deps.ts';
import { redirectHandler } from './handler.ts';

// Public endpoint: deploy with `supabase functions deploy r --no-verify-jwt`.
Deno.serve(redirectHandler(await productionDeps()));
