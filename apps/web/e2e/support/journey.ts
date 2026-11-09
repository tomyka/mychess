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

/** What `freshEmail` makes: `e2e-`, a UUID's first 12 characters, the test domain. */
const FRESH_EMAIL = /^e2e-[0-9a-f]{8}-[0-9a-f]{3}@mychess\.test$/;

/**
 * `email`, if `freshEmail` could have made it; else throws. The helpers
 * that write the database straight call it, so a persona or any other
 * account is never touched.
 */
export function requireFreshEmail(email: string): string {
  if (!FRESH_EMAIL.test(email))
    throw new Error(`not a fresh test account: ${email}`);
  return email;
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
 * Fills the onboarding screen: the display name only, as no language is
 * offered to choose (R-180). The name field is found by its role and the
 * submit button by its English name.
 */
export async function onboard(
  page: Page,
  { name }: { name: string },
): Promise<void> {
  await expect(page).toHaveURL(/\/pradzia$/);
  await page.getByRole('textbox').fill(name);
  await page.getByRole('button', { name: en.onboarding.submit }).click();
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

/** A new account, signed in by magic link and onboarded, in English (R-180). */
export async function newOnboardedAccount(
  page: Page,
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const email = freshEmail();
  await signIn(page, request, en, email);
  await onboard(page, { name });
  await expectGreeting(page, en, name);
  return email;
}
