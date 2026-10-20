import { createApp } from './app.js';
import { config } from './config.js';
import { startRateLimitJanitor } from './lib/pgRateLimitStore.js';
import { migrate } from './migrate.js';

if (config.isProd && process.env.RUN_MIGRATIONS_ON_START !== 'false') await migrate();

if (config.rateLimitStore === 'postgres' && !config.rateLimitDisabled) startRateLimitJanitor();

createApp().listen(config.port, () => {
  console.log(`LinkPulse API listening on http://localhost:${config.port}`);
  console.log(`Short links will look like ${config.shortBaseUrl}/abc1234`);
  if (!config.safeBrowsingKey) console.log('Threat intelligence: not configured (set GOOGLE_SAFE_BROWSING_API_KEY to enable).');
  if (config.emailProvider === 'console') {
    console.log(`Email: provider "console" — verification and reset emails are ${config.isProd ? 'NOT delivered' : 'printed here'}. Set EMAIL_PROVIDER=resend to send real mail.`);
  }
  if (config.emailProvider === 'smtp' && !config.smtpHost) console.warn('EMAIL_PROVIDER=smtp but SMTP_HOST is empty: emails will fail to send.');
  if (config.emailProvider === 'resend' && !config.resendApiKey) console.warn('EMAIL_PROVIDER=resend but RESEND_API_KEY is empty: emails will fail to send.');
  console.log(`Rate limits: ${config.rateLimitStore === 'postgres' ? 'shared in PostgreSQL (safe with several instances)' : 'in memory (single instance only)'}.`);
});
