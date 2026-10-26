import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
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

const { lt, en } = CATALOGUES;

/** From the Lithuanian home page to settings. */
async function openSettings(page: Page): Promise<void> {
  await page.getByRole('link', { name: lt.app.settings }).click();
  await expect(page).toHaveURL(/\/nustatymai$/);
}

/** In Lithuanian settings: a new display name and English, saved. */
async function switchToEnglish(page: Page, name: string): Promise<void> {
  await page
    .getByLabel(lt.settings.profile.displayName, { exact: true })
    .fill(name);
  await page.getByRole('radio', { name: en.language.en }).check();
  // The profile's own Save: the training limits have one too (S6).
  await page
    .getByRole('region', { name: lt.settings.profile.title })
    .getByRole('button', { name: lt.settings.profile.submit })
    .click();
  // The page comes back in the language just chosen.
  await expect(page.getByText(en.settings.profile.saved)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
}

test('a changed name and language show at once and stay, because the account locale wins over the cookie', async ({
  page,
  request,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error('playwright.config sets baseURL');
  await newOnboardedAccount(page, request, 'Gabija');
  await openSettings(page);

  await switchToEnglish(page, 'Gabija N.');
  await page.getByRole('link', { name: en.settings.home }).click();
  await expectGreeting(page, en, 'Gabija N.');

  // A cookie that says Lithuanian loses to the account's English.
  await page
    .context()
    .addCookies([{ name: LOCALE_COOKIE, value: 'lt', url: baseURL }]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expectGreeting(page, en, 'Gabija N.');
});

test('G-M1-5: English chosen in settings follows the account to another device', async ({
  page,
  request,
  browser,
}) => {
  const email = await newOnboardedAccount(page, request, 'Gabija');
  await openSettings(page);
  await switchToEnglish(page, 'Gabija');
  await page.getByRole('link', { name: en.settings.home }).click();
  await page.getByRole('button', { name: en.app.signOut }).click();
  await expect(page).toHaveURL(/\/prisijungti$/);

  // The phone has no locale cookie: sign-in is Lithuanian until she is in.
  const other = await newDevice(browser);
  try {
    const phone = await other.newPage();
    await signIn(phone, request, lt, email);
    await expect(phone).toHaveURL(/\/$/);
    await expect(phone.locator('html')).toHaveAttribute('lang', 'en');
    await expectGreeting(phone, en, 'Gabija');
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
    .getByRole('link', { name: lt.settings.export.download, exact: true })
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
    format(lt.settings.delete.typeName, { name: 'Rokas P' }),
    { exact: true },
  );
  const confirm = page.getByRole('button', {
    name: lt.settings.delete.confirm,
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
  expect(mail.Subject).toBe(lt.mail.deleted.subject);
  await expect(page.getByRole('status')).toHaveText(lt.signIn.deleted);

  // The old account is gone: the same email starts over at onboarding.
  const again = await requestLink(page, request, lt, {
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
  await signIn(page, request, lt, email);
  await expect(page).toHaveURL(/\/pradzia$/);

  await page.getByText(lt.onboarding.deleteAccount, { exact: true }).click();
  const typed = page.getByLabel(
    format(lt.settings.delete.typeEmail, { email }),
    { exact: true },
  );
  const confirm = page.getByRole('button', {
    name: lt.settings.delete.confirm,
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
  expect(mail.Subject).toBe(lt.mail.deleted.subject);
});
