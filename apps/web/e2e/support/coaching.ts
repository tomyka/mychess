// Coaching steps for the E2E journeys (S4 Task A18): Coach mode, groups,
// invites, and accepting an invite.
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { en, format, freshEmail, requestLink, type Messages } from './journey';
import { linkIn } from './mailpit';
import { fromAccountMenu } from './nav';

/** From the account menu to settings, then Coach mode on; the Coach tab then shows. */
export async function switchOnCoachMode(
  page: Page,
  messages: Messages,
): Promise<void> {
  const t = messages.settings.coachMode;
  await fromAccountMenu(page, messages, 'settings');
  await expect(page).toHaveURL(/\/settings/);
  await page.getByRole('button', { name: t.switchOn }).click();
  // Switched on, the card offers to switch it off (#381 part 6).
  await expect(page.getByRole('button', { name: t.switchOff })).toBeVisible();
}

/** An invite link as the dashboard shows it once. */
const INVITE_LINK = /\/invite\/[A-Za-z0-9_-]{43}$/;

/**
 * On the coach dashboard: New group, then a new group named `name`;
 * returns the group invite link it is made with, shown once in the
 * groups section (R-204). The section's name carries its count
 * ("Groups · 1"), so it is matched from its start.
 */
export async function createGroup(
  page: Page,
  messages: Messages,
  name: string,
): Promise<string> {
  const t = messages.coach.groups;
  const section = page.getByRole('region', {
    name: new RegExp(`^${t.title} · `, 'u'),
  });
  await section.getByRole('button', { name: t.new, exact: true }).click();
  await section.getByLabel(t.name, { exact: true }).fill(name);
  await section.getByRole('button', { name: t.create }).click();
  await expect(section.getByRole('link', { name, exact: true })).toBeVisible();
  const field = section.getByLabel(messages.coach.invites.link, {
    exact: true,
  });
  await expect(field).toHaveValue(INVITE_LINK);
  return field.inputValue();
}

/**
 * On the coach dashboard: Invite a player opens the sheet, Create link
 * makes a personal invite (R-232); returns its link, shown once, and
 * closes the sheet. The header's button comes first (with no player yet,
 * the Players section has one too).
 */
export async function createInvite(
  page: Page,
  messages: Messages,
): Promise<string> {
  const sheet = await openInviteSheet(page, messages);
  const t = messages.coach.inviteSheet;
  await sheet.getByRole('button', { name: t.create, exact: true }).click();
  const field = sheet.getByLabel(messages.coach.invites.link, {
    exact: true,
  });
  await expect(field).toHaveValue(INVITE_LINK);
  const link = await field.inputValue();
  await sheet.getByRole('button', { name: t.close, exact: true }).click();
  await expect(sheet).toBeHidden();
  return link;
}

/** On the coach dashboard: opens the Invite a player sheet and returns it. */
export async function openInviteSheet(
  page: Page,
  messages: Messages,
): Promise<Locator> {
  const t = messages.coach.inviteSheet;
  await page
    .getByRole('button', { name: t.title, exact: true })
    .first()
    .click();
  const sheet = page.getByRole('dialog', { name: t.title });
  await expect(sheet).toBeVisible();
  return sheet;
}

/**
 * From the coach dashboard to the group's page, then New link in its
 * Invite link section (R-232); returns the new group invite link, shown
 * once there. The section then says when the open link expires.
 */
export async function newGroupLink(
  page: Page,
  messages: Messages,
  group: string,
): Promise<string> {
  const t = messages.coach.group;
  await page.getByRole('link', { name: group, exact: true }).click();
  await expect(page).toHaveURL(/\/coach\/groups\//);
  const section = page.getByRole('region', { name: t.inviteTitle });
  await section.getByRole('button', { name: t.newLink, exact: true }).click();
  const field = section.getByLabel(messages.coach.invites.link, {
    exact: true,
  });
  await expect(field).toHaveValue(INVITE_LINK);
  // The whole sentence, its date as written ("Dec 4", or "Jan 2, 2027").
  const [before = '', after = ''] = t.openLink.split('{date}');
  await expect(
    section.getByText(
      new RegExp(`^${before}[A-Z][a-z]{2} \\d{1,2}(, \\d{4})?${after}$`, 'u'),
    ),
  ).toBeVisible();
  return field.inputValue();
}

/**
 * On the invite's confirm screen: Accept, landing on Today, which says
 * whom the player is now linked with (R-234). Once said, `?linked=` and
 * `?group=` leave the address, so a reload does not say it again.
 */
export async function acceptInvite(
  page: Page,
  messages: Messages,
): Promise<void> {
  await page.getByRole('button', { name: messages.invite.accept }).click();
  const [before] = messages.today.linked.split('{coach}');
  await expect(
    page.getByRole('status').filter({ hasText: before ?? '' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/u);
}

/** The confirm screen's heading names the coach and, for a group invite, the group. */
export async function expectInviteFrom(
  page: Page,
  messages: Messages,
  { coach, group }: { coach: string; group?: string },
): Promise<void> {
  const t = messages.invite;
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    group === undefined
      ? format(t.titlePersonal, { coach })
      : format(t.titleGroup, { coach, group }),
  );
}

/** Who sent an invite: the coach and, for a group invite, the group. */
interface Inviter {
  readonly coach: string;
  readonly group?: string;
}

/** Sign-in names the invite's coach and group before any sign-in (R-235). */
async function expectSignInTeaser(
  page: Page,
  { coach, group }: Inviter,
): Promise<void> {
  const t = en.signIn;
  await expect(
    page.getByText(
      group === undefined
        ? format(t.invitedPersonal, { coach })
        : format(t.invitedToGroup, { coach, group }),
      { exact: true },
    ),
  ).toBeVisible();
}

/**
 * Signed out, opens `link`: sign-in by magic link, then onboarding as
 * `name`, each carrying the invite back (R-81), and lands on
 * the confirm screen. Given `from`, sign-in names the coach and group and
 * welcome says the invite comes next (R-235).
 */
export async function signUpThroughInvite(
  page: Page,
  request: APIRequestContext,
  { link, name, from }: { link: string; name: string; from?: Inviter },
): Promise<void> {
  const token = /\/invite\/([A-Za-z0-9_-]{43})$/.exec(link)?.[1];
  if (token === undefined) throw new Error(`no token in ${link}`);
  const next = encodeURIComponent(`/invite/${token}`);
  await page.goto(link);
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${next}$`));
  if (from !== undefined) await expectSignInTeaser(page, from);
  const email = freshEmail();
  const mail = await requestLink(page, request, en, {
    typed: email,
    inbox: email,
  });
  await page.goto(linkIn(mail.Text));
  await expect(page).toHaveURL(new RegExp(`/welcome\\?next=${next}$`));
  if (from !== undefined)
    await expect(
      page.getByText(format(en.onboarding.nextInvite, { coach: from.coach }), {
        exact: true,
      }),
    ).toBeVisible();
  // Only the name: no language is offered to choose.
  await page.getByRole('textbox').fill(name);
  await page.getByRole('button', { name: en.onboarding.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/invite/${token}$`));
}
