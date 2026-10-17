import { expect } from '@playwright/test';
import { LOCALE_COOKIE, test } from './support/journey';

test('a signed-out visitor to the home page lands on sign-in, in Lithuanian by default', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/prisijungti$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'lt');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('sign-in is in English when the locale cookie says en', async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error('playwright.config sets baseURL');
  await page
    .context()
    .addCookies([{ name: LOCALE_COOKIE, value: 'en', url: baseURL }]);

  await page.goto('/');

  await expect(page).toHaveURL(/\/prisijungti$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
