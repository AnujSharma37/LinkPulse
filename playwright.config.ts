import { defineConfig, devices } from '@playwright/test';

const exe = process.env.PW_CHROMIUM_PATH; // optional: use a pre-installed Chromium
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4000',
    launchOptions: exe ? { executablePath: exe } : undefined,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
