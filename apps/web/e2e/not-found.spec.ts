// The app's 404 (#381 part 6, plan Task 14): one line and the way back to
// Today, in the shell for an onboarded account and in the entry frame for
// a visitor.
import { expect, type Locator, type Page } from '@playwright/test';
import {
  en,
  expectGreeting,
  newOnboardedAccount,
  test,
} from './support/journey';
import { mainNav } from './support/nav';
import { expectSheetShape } from './support/sheet';

const NO_SUCH_PAGE = '/no-such-page';

/** The 404's heading, its line and Go to Today, answered with status 404. */
async function expectNotFound(page: Page): Promise<void> {
  const response = await page.goto(NO_SUCH_PAGE);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    en.notFound.title,
  );
  await expect(page.getByText(en.notFound.body, { exact: true })).toBeVisible();
}

/** The 404's one way on. */
const goToday = (page: Page): Locator =>
  page.getByRole('link', { name: en.nav.goToday, exact: true });

test('a page that does not exist says so, in the shell, and Go to Today leads home', async ({
  page,
  request,
}) => {
  await newOnboardedAccount(page, request, 'Gabija Navickaitė');
  await expectNotFound(page);
  await expect(mainNav(page, en)).toBeVisible();
  await goToday(page).click();
  await expect(page).toHaveURL(/\/$/u);
  await expectGreeting(page, en, 'Gabija Navickaitė');
});

test('signed out, a page that does not exist says so without the shell', async ({
  page,
}) => {
  await expectNotFound(page);
  await expect(mainNav(page, en)).toHaveCount(0);
  await goToday(page).click();
  // Today asks a visitor to sign in first.
  await expect(page).toHaveURL(/\/sign-in/u);
});

test(
  '#400: on a phone, the 404 in the shell carries the account menu, and it opens as a sheet',
  { tag: '@mobile' },
  async ({ page, request, isMobile }) => {
    const name = 'Gabija Navickaitė';
    const email = await newOnboardedAccount(page, request, name);
    await expectNotFound(page);
    const avatar = page.getByRole('button', { name: en.nav.account.open });
    await expect(avatar).toBeVisible();
    await avatar.click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    const sheet = page.getByRole('dialog', { name });
    if (isMobile) await expectSheetShape(page, sheet, true);
    else await expect(sheet).toHaveCount(0);
  },
);
