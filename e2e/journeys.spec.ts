/**
 * Browser tests of the required user journeys against a running LinkPulse server
 * (production build: `npm run build && npm start`). Runs on desktop and mobile viewports.
 */
import { expect, test, type Page } from '@playwright/test';

const shots = process.env.E2E_SCREENSHOTS; // directory to save screenshots into, optional

async function snap(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-${name}.png`, fullPage: true });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page should not scroll horizontally').toBeLessThanOrEqual(1);
}

async function openMenuIfMobile(page: Page) {
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
}

test('full journey: sign up → create → refresh → redirect → analytics → rules', async ({ page, context, request }) => {
  const email = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;

  // Landing
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Shorten links');
  await noHorizontalScroll(page);
  await snap(page, '01-landing');

  // 1. Sign up (with a validation error first)
  await page.getByRole('link', { name: 'Get started' }).click();
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await page.getByLabel('Name (optional)').fill('Priya');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('hackathon26');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: /Welcome back, Priya/ })).toBeVisible();
  await expect(page.getByText('Create your first short link')).toBeVisible();
  await noHorizontalScroll(page);
  await snap(page, '02-empty-dashboard');

  // 2. Create a short link with a custom alias
  const alias = `e2e-${Date.now().toString(36)}`;
  await page.goto('/links/new');
  await page.getByLabel('Destination URL').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Create short link' }).click();
  await expect(page.getByText('Only http:// and https:// URLs are allowed.')).toBeVisible();
  await page.getByLabel('Destination URL').fill('https://example.com/hackathon?from=e2e');
  await page.getByLabel(/Custom alias/).fill(alias);
  await page.getByLabel(/Title/).fill('Hackathon page');
  await page.getByRole('button', { name: 'Create short link' }).click();
  await expect(page.getByTestId('created')).toBeVisible();
  const shortUrl = (await page.getByTestId('short-url').textContent())!.trim();
  expect(shortUrl).toMatch(new RegExp(`/${alias}$`));
  await expect(page.getByText('URL format valid').first()).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await noHorizontalScroll(page);
  await snap(page, '03-created');

  // 3. Appears in My Links after a full reload
  await page.goto('/links');
  await page.reload();
  await expect(page.getByTestId('link-row').filter({ hasText: alias })).toBeVisible();
  await noHorizontalScroll(page);

  // 4. Visitor opens the short URL (separate, logged-out context) and reaches the destination
  const visit = await request.get(`/${alias}`, { maxRedirects: 0, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari', Referer: 'https://news.ycombinator.com/item' } });
  expect(visit.status()).toBe(302);
  expect(visit.headers()['location']).toBe('https://example.com/hackathon?from=e2e');

  // 5. Analytics update
  await page.getByTestId('link-row').filter({ hasText: alias }).getByRole('link', { name: new RegExp(`/${alias}$`) }).click();
  await expect(page.getByRole('heading', { name: 'Hackathon page' })).toBeVisible();
  await expect(page.getByText('1 (no limit)')).toBeVisible();
  await expect(page.getByText('news.ycombinator.com').first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'mobile' })).toBeVisible();
  await noHorizontalScroll(page);
  await snap(page, '04-link-detail');

  // 6. Disable → visitor sees "disabled" page; re-enable
  await page.getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByText('Link disabled.')).toBeVisible();
  const visitor = await context.browser()!.newPage();
  await visitor.goto(`/${alias}`);
  await expect(visitor.getByRole('heading', { name: 'This link has been disabled' })).toBeVisible();
  await visitor.goto('/no-such-link-xyz');
  await expect(visitor.getByRole('heading', { name: 'This short link doesn’t exist' })).toBeVisible();
  await page.getByRole('button', { name: 'Enable' }).click();
  await expect(page.getByText('Link enabled.')).toBeVisible();

  // 7 + 8. Password-protected link with a click limit of 1
  await page.goto('/links/new');
  await page.getByLabel('Destination URL').fill('https://example.org/members');
  await page.getByText('Access rules — expiry, password, click limit').click();
  await page.getByLabel('Click limit (optional)').fill('1');
  await page.getByLabel('Require a password to open this link').check();
  await page.getByLabel('Link password').fill('letmein');
  await page.getByRole('button', { name: 'Create short link' }).click();
  const protectedUrl = (await page.getByTestId('short-url').textContent())!.trim();
  const code = new URL(protectedUrl).pathname;

  await visitor.goto(code);
  await expect(visitor.getByRole('heading', { name: 'This link is password-protected' })).toBeVisible();
  await snap(visitor, '05-password');
  await visitor.getByLabel('Password').fill('wrong-password');
  await visitor.getByRole('button', { name: 'Unlock and continue' }).click();
  await expect(visitor.getByText('Incorrect password. Please try again.')).toBeVisible();
  // Correct password → redirect (intercept so the test doesn't depend on the internet)
  await visitor.route('https://example.org/**', (r) => r.fulfill({ status: 200, body: '<h1>members area</h1>', contentType: 'text/html' }));
  await visitor.getByLabel('Password').fill('letmein');
  await visitor.getByRole('button', { name: 'Unlock and continue' }).click();
  await expect(visitor).toHaveURL('https://example.org/members');
  // Limit of 1 is now used up
  await visitor.goto(code);
  await expect(visitor.getByRole('heading', { name: 'This link has reached its click limit' })).toBeVisible();
  await visitor.close();

  // Suspicious link needs explicit confirmation
  await page.goto('/links/new');
  await page.getByLabel('Destination URL').fill('http://203.0.113.9:8080/login');
  await page.getByRole('button', { name: 'Create short link' }).click();
  await expect(page.getByText('Suspicious').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create short link' })).toBeDisabled();
  await page.getByLabel(/I’ve reviewed these warnings/).check();
  await page.getByRole('button', { name: 'Create short link' }).click();
  await expect(page.getByTestId('created')).toBeVisible();

  // Blocked destination is refused
  await page.getByRole('button', { name: 'Create another' }).click();
  await page.getByLabel('Destination URL').fill('http://localhost:22/');
  await page.getByRole('button', { name: 'Create short link' }).click();
  await expect(page.getByText('This destination is blocked by LinkPulse safety checks.')).toBeVisible();

  // Campaigns & tags
  await openMenuIfMobile(page);
  await page.getByRole('link', { name: 'Campaigns & Tags' }).click();
  await page.getByRole('button', { name: 'New campaign' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Posters');
  await page.getByLabel('utm_source').fill('poster');
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByRole('cell', { name: 'Posters', exact: true })).toBeVisible();
  await page.getByLabel('New tag name').fill('print');
  await page.getByRole('button', { name: 'Add tag' }).click();
  await expect(page.getByRole('link', { name: 'print' })).toBeVisible();
  await noHorizontalScroll(page);
  await snap(page, '06-campaigns');

  // Analytics dashboard has real totals
  await openMenuIfMobile(page);
  await page.getByRole('link', { name: 'Analytics' }).click();
  await expect(page.getByRole('heading', { name: 'Clicks per day' })).toBeVisible();
  await noHorizontalScroll(page);
  await snap(page, '07-analytics');

  // Dashboard + logout
  await openMenuIfMobile(page);
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByText('Total links')).toBeVisible();
  await snap(page, '08-dashboard');
  await openMenuIfMobile(page);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/links');
  await expect(page).toHaveURL(/\/login\?next=%2Flinks/);

  // Log back in → data still there
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('hackathon26');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/links/);
  await expect(page.getByTestId('link-row')).toHaveCount(3);
});

test("9. a user can't view another user's link in the UI", async ({ browser }) => {
  const mk = async (tag: string) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/signup');
    await page.getByLabel('Email').fill(`${tag}_${Date.now()}@example.com`);
    await page.getByLabel('Password').fill('hackathon26');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/dashboard/);
    return page;
  };
  const a = await mk('owner');
  const b = await mk('intruder');
  const res = await a.request.post('/api/links', { data: { destinationUrl: 'https://example.com/private' } });
  const { link } = await res.json();
  await b.goto(`/links/${link.id}`);
  await expect(b.getByRole('heading', { name: 'Link not found' })).toBeVisible();
  const patch = await b.request.patch(`/api/links/${link.id}`, { data: { destinationUrl: 'https://evil.example.com' } });
  expect(patch.status()).toBe(404);
});
