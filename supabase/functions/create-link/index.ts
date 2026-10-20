import { productionDeps } from '../_shared/deps.ts';
import { createLinkHandler } from './handler.ts';

Deno.serve(createLinkHandler(await productionDeps()));
