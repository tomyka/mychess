import { expect } from '@playwright/test';
import { linkIn } from './support/mailpit';
import {
  en,
  expectGreeting,
  freshEmail,
  newDevice,
  newOnboardedAccount,
  onboard,
  requestLink,
  test,
} from './support/journey';

// The magic-link round trip (S1 spec, Testing), run at phone and desktop
// width by the two Playwright projects. The journey IDs are the persona
// journeys' sign-in step (docs/personas). The UI is English only and
// offers no language choice (#378).

test(
  'U1-M1-1, C-M1-1: a new player signs in by magic link in English and is onboarded with no language choice',
  { tag: '@mobile' },
  async ({ page, request }) => {
    const email = freshEmail();

    await page.goto('/');
    await expect(page).toHaveURL(/\/prisijungti$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      en.signIn.title,
    );
    await expect(page.getByRole('radio')).toHaveCount(0);
    const mail = await requestLink(page, request, en, {
      typed: email,
      inbox: email,
    });
    expect(mail.Subject).toBe(en.mail.magicLink.subject);

    await page.goto(linkIn(mail.Text));
    await expect(page).toHaveURL(/\/pradzia$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      en.onboarding.title,
    );
    await expect(page.getByText(en.onboarding.intro)).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(
      page.getByLabel(en.onboarding.displayName, { exact: true }),
    ).toHaveValue('');

    await onboard(page, { name: 'Rokas' });
    await expectGreeting(page, en, 'Rokas');
  },
);

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
    const mail = await requestLink(phone, request, en, {
      typed: email.toUpperCase(),
      inbox: email,
    });
    await phone.goto(linkIn(mail.Text));

    // Already onboarded: home, not /pradzia, so it is the one account.
    await expect(phone).toHaveURL(/\/$/);
    await expectGreeting(phone, en, 'Gabija');
  } finally {
    await other.close();
  }
});

test('after signing out, the home page sends the visitor to sign-in', async ({
  page,
  request,
}) => {
  await newOnboardedAccount(page, request, 'Rimantas');

  await page.getByRole('button', { name: en.app.signOut }).click();
  await expect(page).toHaveURL(/\/prisijungti$/);

  await page.goto('/');
  await expect(page).toHaveURL(/\/prisijungti$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    en.signIn.title,
  );
});
