import { productionDeps } from '../_shared/deps.ts';
import { updateLinkHandler } from './handler.ts';

Deno.serve(updateLinkHandler(await productionDeps()));
