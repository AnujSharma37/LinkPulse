import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { config } from './config.js';
import { query } from './db.js';
import { loadUser } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';
import { apiCsrfGuard, apiLimiter } from './middleware/security.js';
import { analyticsRouter } from './routes/analytics.js';
import { authRouter } from './routes/auth.js';
import { campaignsRouter } from './routes/campaigns.js';
import { linksRouter } from './routes/links.js';
import { redirectRouter } from './routes/redirect.js';
import { safetyRouter } from './routes/safety.js';
import { tagsRouter } from './routes/tags.js';

const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
/** Client-side routes of the React app. Everything else at "/:code" is treated as a short link. */
const SPA_ROUTES = [
  '/', '/login', '/signup', '/forgot-password', '/reset-password', '/verify-email',
  '/dashboard', '/links', '/links/new', '/links/:id', '/analytics', '/campaigns',
];

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy === 'false' ? false : /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    next();
  });
  app.use(cookieParser());

  // ── JSON API ──
  const api = express.Router();
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }); // account data must never sit in a shared cache
  api.use(apiLimiter);
  api.use(express.json({ limit: '20kb' }));
  api.use(apiCsrfGuard);
  api.use(loadUser);
  api.get('/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ ok: true });
  });
  api.get('/config', (_req, res) => {
    res.json({
      shortBaseUrl: config.shortBaseUrl,
      threatIntelEnabled: Boolean(config.safeBrowsingKey),
      emailVerificationRequired: config.requireEmailVerification,
    });
  });
  api.use('/auth', authRouter);
  api.use('/links', linksRouter);
  api.use('/analytics', analyticsRouter);
  api.use('/campaigns', campaignsRouter);
  api.use('/tags', tagsRouter);
  api.use('/safety', safetyRouter);
  api.use((_req, res) => { res.status(404).json({ error: { code: 'not_found', message: 'API route not found.' } }); });
  app.use('/api', api);

  // ── Built React app (production) ──
  const hasWeb = fs.existsSync(path.join(webDist, 'index.html'));
  if (hasWeb) {
    app.use('/assets', express.static(path.join(webDist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.get('/favicon.svg', (_req, res) => res.sendFile(path.join(webDist, 'favicon.svg')));
    app.get(SPA_ROUTES, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  } else {
    app.get('/', (_req, res) => {
      res.type('text').send(`LinkPulse API is running. Start the web app with "npm run dev" and open ${config.appOrigin}`);
    });
  }
  app.get('/robots.txt', (_req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));

  // ── Short links (must be last) ──
  app.use(redirectRouter);
  app.use(errorHandler);
  return app;
}
