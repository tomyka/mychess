import { expect } from '@playwright/test';
import { linkIn } from './support/mailpit';
import {
  CATALOGUES,
  expectGreeting,
  freshEmail,
  LOCALE_COOKIE,
  newDevice,
  newOnboardedAccount,
  onboard,
  requestLink,
  test,
} from './support/journey';

const { lt, en } = CATALOGUES;

// The magic-link round trip (S1 spec, Testing), run at phone and desktop
// width by the two Playwright projects. The journey IDs are the persona
// journeys' sign-in step (docs/personas).

test('U1-M1-1, C-M1-1: a new player signs in by magic link in Lithuanian and is onboarded', async ({
  page,
  request,
}) => {
  const email = freshEmail();

  await page.goto('/');
  await expect(page).toHaveURL(/\/prisijungti$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    lt.signIn.title,
  );
  const mail = await requestLink(page, request, lt, {
    typed: email,
    inbox: email,
  });
  expect(mail.Subject).toBe(lt.mail.magicLink.subject);

  await page.goto(linkIn(mail.Text));
  await expect(page).toHaveURL(/\/pradzia$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'lt');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    lt.onboarding.title,
  );
  await expect(page.getByRole('radio', { name: lt.language.lt })).toBeChecked();
  await expect(
    page.getByLabel(lt.onboarding.displayName, { exact: true }),
  ).toHaveValue('');

  await onboard(page, { name: 'Rokas', locale: 'lt' });
  await expectGreeting(page, lt, 'Rokas');
});

test('an English visitor gets the mail in English and, choosing English, the English home page', async ({
  page,
  request,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error('playwright.config sets baseURL');
  await page
    .context()
    .addCookies([{ name: LOCALE_COOKIE, value: 'en', url: baseURL }]);
  const email = freshEmail();

  await page.goto('/');
  await expect(page).toHaveURL(/\/prisijungti$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    en.signIn.title,
  );
  const mail = await requestLink(page, request, en, {
    typed: email,
    inbox: email,
  });
  expect(mail.Subject).toBe(en.mail.magicLink.subject);

  await page.goto(linkIn(mail.Text));
  await onboard(page, { name: 'Dovydas', locale: 'en' });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expectGreeting(page, en, 'Dovydas');
});

test('signing in again with the email upper-cased reaches the same account', async ({
  page,
  request,
  browser,
}) => {
  const email = await newOnboardedAccount(page, request, 'Gabija');

  // A fresh browser, so the second sign-in starts signed out.
  const other = await newDevice(browser);
  try {
    const phone = await other.newPage();
    await phone.goto('/prisijungti');
    const mail = await requestLink(phone, request, lt, {
      typed: email.toUpperCase(),
      inbox: email,
    });
    await phone.goto(linkIn(mail.Text));

    // Already onboarded: home, not /pradzia, so it is the one account.
    await expect(phone).toHaveURL(/\/$/);
    await expectGreeting(phone, lt, 'Gabija');
  } finally {
    await other.close();
  }
});

test('after signing out, the home page sends the visitor to sign-in', async ({
  page,
  request,
}) => {
  await newOnboardedAccount(page, request, 'Rimantas');

  await page.getByRole('button', { name: lt.app.signOut }).click();
  await expect(page).toHaveURL(/\/prisijungti$/);

  await page.goto('/');
  await expect(page).toHaveURL(/\/prisijungti$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    lt.signIn.title,
  );
});
