import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { storedLocale, storeLocale } from './support/account-db';
import { linkIn, nextMailTo } from './support/mailpit';
import {
  CATALOGUES,
  expectGreeting,
  format,
  freshEmail,
  LOCALE_COOKIE,
  newDevice,
  newOnboardedAccount,
  requestLink,
  signIn,
  test,
} from './support/journey';

// The UI is English only for now and offers no language choice (R-180).
const { en } = CATALOGUES;

/** From the home page to settings. */
async function openSettings(page: Page): Promise<void> {
  await page.getByRole('link', { name: en.app.settings }).click();
  await expect(page).toHaveURL(/\/nustatymai$/);
}

/** In settings: a new display name, saved. */
async function rename(page: Page, name: string): Promise<void> {
  await page
    .getByLabel(en.settings.profile.displayName, { exact: true })
    .fill(name);
  // The profile's own Save: the training limits have one too (S6).
  await page
    .getByRole('region', { name: en.settings.profile.title })
    .getByRole('button', { name: en.settings.profile.submit })
    .click();
  await expect(page.getByText(en.settings.profile.saved)).toBeVisible();
}

test('settings offer no language choice; a changed name shows at once and the page stays English despite a Lithuanian cookie', async ({
  page,
  request,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error('playwright.config sets baseURL');
  await newOnboardedAccount(page, request, 'Gabija');
  await openSettings(page);
  await expect(page.getByRole('radio')).toHaveCount(0);

  await rename(page, 'Gabija N.');
  await page.getByRole('link', { name: en.settings.home }).click();
  await expectGreeting(page, en, 'Gabija N.');

  await page
    .context()
    .addCookies([{ name: LOCALE_COOKIE, value: 'lt', url: baseURL }]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expectGreeting(page, en, 'Gabija N.');
});

test('G-M1-5: an account stored in Lithuanian is served English on every device, and saving settings keeps its stored language', async ({
  page,
  request,
  browser,
}) => {
  const email = await newOnboardedAccount(page, request, 'Gabija');
  await storeLocale(email, 'lt');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expectGreeting(page, en, 'Gabija');
  await openSettings(page);
  await rename(page, 'Gabija N.');
  expect(await storedLocale(email)).toBe('lt');

  const other = await newDevice(browser);
  try {
    const phone = await other.newPage();
    await signIn(phone, request, en, email);
    await expect(phone).toHaveURL(/\/$/);
    await expect(phone.locator('html')).toHaveAttribute('lang', 'en');
    await expectGreeting(phone, en, 'Gabija N.');
  } finally {
    await other.close();
  }
});

test('D-M3-5 (S1 part): the export link downloads JSON with the account email', async ({
  page,
  request,
}) => {
  const email = await newOnboardedAccount(page, request, 'Dovydas');
  await openSettings(page);

  const downloading = page.waitForEvent('download');
  await page
    .getByRole('link', { name: en.settings.export.download, exact: true })
    .click();
  const download = await downloading;

  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const text = await readFile(await download.path(), 'utf8');
  const data: unknown = JSON.parse(text);
  expect(JSON.stringify(data)).toContain(email);
});

test('deleting needs the exact display name, mails a confirmation, and frees the email for a new account', async ({
  page,
  request,
}) => {
  const email = await newOnboardedAccount(page, request, 'Rokas P');
  await openSettings(page);
  const typed = page.getByLabel(
    format(en.settings.delete.typeName, { name: 'Rokas P' }),
    { exact: true },
  );
  const confirm = page.getByRole('button', {
    name: en.settings.delete.confirm,
  });

  await expect(confirm).toBeDisabled();
  await typed.fill('Rokas');
  await expect(confirm).toBeDisabled();
  await typed.fill('Rokas P');
  await expect(confirm).toBeEnabled();

  const mail = await nextMailTo(request, email, async () => {
    await confirm.click();
    await expect(page).toHaveURL(/\/prisijungti\?deleted=1$/);
  });
  expect(mail.Subject).toBe(en.mail.deleted.subject);
  await expect(page.getByRole('status')).toHaveText(en.signIn.deleted);

  // The old account is gone: the same email starts over at onboarding.
  const again = await requestLink(page, request, en, {
    typed: email,
    inbox: email,
  });
  await page.goto(linkIn(again.Text));
  await expect(page).toHaveURL(/\/pradzia$/);
});

test('an account that has not finished onboarding deletes itself by typing its email (R-86)', async ({
  page,
  request,
}) => {
  const email = freshEmail();
  await signIn(page, request, en, email);
  await expect(page).toHaveURL(/\/pradzia$/);

  // The disclosure's summary: in English the section heading inside it
  // reads the same.
  await page
    .locator('summary', { hasText: en.onboarding.deleteAccount })
    .click();
  const typed = page.getByLabel(
    format(en.settings.delete.typeEmail, { email }),
    { exact: true },
  );
  const confirm = page.getByRole('button', {
    name: en.settings.delete.confirm,
  });
  await expect(confirm).toBeDisabled();
  await typed.fill('e2e-someone-else@mychess.test');
  await expect(confirm).toBeDisabled();
  await typed.fill(email.toUpperCase());
  await expect(confirm).toBeEnabled();

  const mail = await nextMailTo(request, email, async () => {
    await confirm.click();
    await expect(page).toHaveURL(/\/prisijungti\?deleted=1$/);
  });
  expect(mail.Subject).toBe(en.mail.deleted.subject);
});
