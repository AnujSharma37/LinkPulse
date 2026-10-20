import express from 'express';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { checkUrlSafety } from '../lib/safety.js';
import { validateDestination } from '../lib/url.js';
import { requireAuth } from '../middleware/auth.js';
import { createLinkLimiter } from '../middleware/security.js';

export const safetyRouter = express.Router();
safetyRouter.use(requireAuth);

/** Preview the safety verdict for a URL before creating a link. Does not fetch the URL. */
safetyRouter.post('/check', createLinkLimiter, async (req, res) => {
  const { url } = z.object({ url: z.string().max(4096) }).strict().parse(req.body);
  const v = validateDestination(url);
  if (!v.ok) throw badRequest(v.error, [{ field: 'url', message: v.error }]);
  res.json({ url: v.href, safety: await checkUrlSafety(v.url) });
});
