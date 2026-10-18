// Coaching steps for the E2E journeys (S4 Task A18): Coach mode, groups,
// invites, and accepting an invite.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  CATALOGUES,
  format,
  freshEmail,
  requestLink,
  type Locale,
  type Messages,
} from './journey';
import { linkIn } from './mailpit';

/** From home to settings, then Coach mode on; home then links the coach area. */
export async function switchOnCoachMode(
  page: Page,
  messages: Messages,
): Promise<void> {
  const t = messages.settings.coachMode;
  await page.getByRole('link', { name: messages.app.settings }).click();
  await expect(page).toHaveURL(/\/nustatymai/);
  await page.getByRole('button', { name: t.switchOn }).click();
  await expect(page.getByText(t.on, { exact: true })).toBeVisible();
}

/** On the coach dashboard: a new group named `name`. */
export async function createGroup(
  page: Page,
  messages: Messages,
  name: string,
): Promise<void> {
  const t = messages.coach.groups;
  await page.getByLabel(t.name, { exact: true }).fill(name);
  await page.getByRole('button', { name: t.create }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

/** On the coach dashboard: a new invite; returns its link, shown once. */
export async function createInvite(
  page: Page,
  messages: Messages,
  { kind, group }: { kind: 'personal' | 'group'; group?: string },
): Promise<string> {
  const t = messages.coach.invites;
  await page.getByRole('radio', { name: t[kind] }).check();
  if (group !== undefined)
    await page
      .getByLabel(t.groupLabel, { exact: true })
      .selectOption({ label: group });
  await page.getByRole('button', { name: t.create }).click();
  const field = page.getByLabel(t.link, { exact: true });
  await expect(field).toHaveValue(/\/k\/[A-Za-z0-9_-]{43}$/);
  return field.inputValue();
}

/** On the invite's confirm screen: Accept, landing on "Mano treneriai". */
export async function acceptInvite(
  page: Page,
  messages: Messages,
): Promise<void> {
  await page.getByRole('button', { name: messages.invite.accept }).click();
  await expect(page).toHaveURL(/\/nustatymai#treneriai$/);
  await expect(
    page.getByRole('heading', { name: messages.settings.myCoaches.title }),
  ).toBeVisible();
}

/** The confirm screen names the coach and, for a group invite, the group. */
export async function expectInviteFrom(
  page: Page,
  messages: Messages,
  { coach, group }: { coach: string; group?: string },
): Promise<void> {
  const t = messages.invite;
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
  await expect(page.getByText(format(t.fromCoach, { coach }))).toBeVisible();
  if (group !== undefined)
    await expect(page.getByText(format(t.toGroup, { group }))).toBeVisible();
}

/**
 * Signed out, opens `link`: sign-in by magic link, then onboarding as
 * `name` in `locale`, each carrying the invite back (R-81), and lands on
 * the confirm screen.
 */
export async function signUpThroughInvite(
  page: Page,
  request: APIRequestContext,
  { link, name, locale }: { link: string; name: string; locale: Locale },
): Promise<void> {
  const token = /\/k\/([A-Za-z0-9_-]{43})$/.exec(link)?.[1];
  if (token === undefined) throw new Error(`no token in ${link}`);
  const next = encodeURIComponent(`/k/${token}`);
  await page.goto(link);
  await expect(page).toHaveURL(new RegExp(`/prisijungti\\?next=${next}$`));
  const email = freshEmail();
  const mail = await requestLink(page, request, CATALOGUES.lt, {
    typed: email,
    inbox: email,
  });
  await page.goto(linkIn(mail.Text));
  await expect(page).toHaveURL(new RegExp(`/pradzia\\?next=${next}$`));
  await page.getByRole('textbox').fill(name);
  await page
    .getByRole('radio', { name: CATALOGUES[locale].language[locale] })
    .check();
  await page.getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`/k/${token}$`));
}
