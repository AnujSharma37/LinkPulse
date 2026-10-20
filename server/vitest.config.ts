import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/linkpulse_test',
      BCRYPT_COST: '4',
      RATE_LIMIT_DISABLED: 'true',
      EMAIL_PROVIDER: 'memory',
      // The cache is off for the general journeys (they edit rows directly in SQL); test/cache.test.ts turns it on.
      LINK_CACHE_TTL_MS: '0',
      SHORT_BASE_URL: 'http://lp.test',
      APP_ORIGIN: 'http://app.test',
      BLOCKLIST_DOMAINS: 'evil.example',
      GOOGLE_SAFE_BROWSING_API_KEY: '',
    },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
