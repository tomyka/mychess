import { randomInt, randomUUID } from 'node:crypto';
import {
  expect,
  test as base,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import en from '../../src/i18n/messages/en.json' with { type: 'json' };
import lt from '../../src/i18n/messages/lt.json' with { type: 'json' };
import { linkIn, nextMailTo, type Mail } from './mailpit';

export type Messages = typeof lt;
export type Locale = 'lt' | 'en';

/** The app's own catalogues, so the tests read what a person reads. */
export const CATALOGUES: Record<Locale, Messages> = { lt, en };

/** The locale cookie next-intl reads (src/i18n/locales.ts LOCALE_COOKIE). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/**
 * Fills a catalogue message's `{name}`-style placeholders and drops its
 * `<tag>` markers, as the rendered text (and its accessible name) reads.
 */
export function format(
  message: string,
  values: Record<string, string>,
): string {
  return message
    .replace(/<\/?\w+>/g, '')
    .replace(/\{(\w+)\}/g, (whole, key: string) =>
      Object.hasOwn(values, key) ? String(values[key]) : whole,
    );
}

/**
 * A client address of its own, so no two tests (in either project, or in a
 * rerun inside the same minute) share a sign-in rate-limit bucket: three
 * magic links and five verifies a minute per address, counted in the
 * database. 10.0.0.0/8 gives 16 million addresses to draw from.
 */
function freshAddress(): string {
  const octet = (): number => randomInt(1, 255);
  return `10.${String(octet())}.${String(octet())}.${String(octet())}`;
}

/** Sends every request of `context` from a fresh client address. */
async function useFreshAddress(context: BrowserContext): Promise<void> {
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': freshAddress() });
}

/** A second browser (another device) with its own address. */
export async function newDevice(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  await useFreshAddress(context);
  return context;
}

/** Every test's browser context sends from its own client address. */
export const test = base.extend<{ freshAddress: undefined }>({
  freshAddress: [
    async ({ context }, use) => {
      await useFreshAddress(context);
      await use(undefined);
    },
    { auto: true },
  ],
});

/** A new `@mychess.test` address nobody has used. */
export function freshEmail(): string {
  return `e2e-${randomUUID().slice(0, 12)}@mychess.test`;
}

/**
 * On the sign-in page (shown in `messages`' language), asks for a magic
 * link to `typed` and returns the mail that arrives at `inbox`.
 */
export async function requestLink(
  page: Page,
  request: APIRequestContext,
  messages: Messages,
  { typed, inbox }: { typed: string; inbox: string },
): Promise<Mail> {
  await page.getByLabel(messages.signIn.email, { exact: true }).fill(typed);
  return nextMailTo(request, inbox, async () => {
    await page.getByRole('button', { name: messages.signIn.submit }).click();
    await expect(page.getByRole('status')).toHaveText(messages.signIn.sent);
  });
}

/** Goes to sign-in and opens the magic link mailed to `email`. */
export async function signIn(
  page: Page,
  request: APIRequestContext,
  messages: Messages,
  email: string,
): Promise<Mail> {
  await page.goto('/prisijungti');
  const mail = await requestLink(page, request, messages, {
    typed: email,
    inbox: email,
  });
  await page.goto(linkIn(mail.Text));
  return mail;
}

/**
 * Fills the onboarding screen. Its own language is the account's (Lithuanian
 * for a new account, R-81), so the fields are found by role, not by label.
 */
export async function onboard(
  page: Page,
  { name, locale }: { name: string; locale: Locale },
): Promise<void> {
  await expect(page).toHaveURL(/\/pradzia$/);
  await page.getByRole('textbox').fill(name);
  await page
    .getByRole('radio', { name: CATALOGUES[locale].language[locale] })
    .check();
  await page.getByRole('button').click();
  await expect(page).toHaveURL(/\/$/);
}

/** The home page greets `name` in `messages`' language. */
export async function expectGreeting(
  page: Page,
  messages: Messages,
  name: string,
): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    format(messages.app.greeting, { name }),
  );
}

/** From home, in Lithuanian settings, switches the account to English, then home. */
export async function chooseEnglish(page: Page): Promise<void> {
  await page.getByRole('link', { name: lt.app.settings }).click();
  await page.getByRole('radio', { name: en.language.en }).check();
  await page.getByRole('button', { name: lt.settings.profile.submit }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('link', { name: en.settings.home }).click();
}

/** A new account, signed in by magic link and onboarded in Lithuanian. */
export async function newOnboardedAccount(
  page: Page,
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const email = freshEmail();
  await signIn(page, request, lt, email);
  await onboard(page, { name, locale: 'lt' });
  await expectGreeting(page, lt, name);
  return email;
}
