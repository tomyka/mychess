// The people of the S5 journeys (plan Task C8): the coach and his players
// (docs/personas/coach.md), each on a device of their own, and the coach's
// group steps the journeys repeat.
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { assignmentRow, deadlineText, openChange } from './assignments';
import { acceptInvite, expectInviteFrom, switchOnCoachMode } from './coaching';
import {
  format,
  newDevice,
  newOnboardedAccount,
  type Messages,
} from './journey';
import { todayRow } from './today';

export const COACH = 'Rimantas Vaitkus';
export const GROUP = 'Šeštadienio grupė';
export const ROKAS = 'Rokas Petrauskas';
export const GABIJA = 'Gabija Navickaitė';
export const DOVYDAS = 'Dovydas Jankauskas';
/** The fourth, unseeded member who takes the group invite later. */
export const FOURTH = 'Austėja Žukauskaitė';

/** One journey's catalogue and the devices it opened, closed at its end. */
export interface Cast {
  readonly messages: Messages;
  readonly browser: Browser;
  readonly request: APIRequestContext;
  readonly devices: BrowserContext[];
}

/** The coach on `page`, Coach mode on, on the coach dashboard. */
export async function coachReady(page: Page, cast: Cast): Promise<void> {
  await newOnboardedAccount(page, cast.request, COACH);
  await switchOnCoachMode(page, cast.messages);
  await page.goto('/coach');
}

/** A player on a device of their own, and the email they signed up with. */
export interface Player {
  readonly page: Page;
  readonly email: string;
}

/** A new player on a device of their own who accepts `link`; on home. */
export async function playerAccepts(
  cast: Cast,
  invite: { link: string; name: string; group?: string },
): Promise<Page> {
  return (await linkedPlayer(cast, invite)).page;
}

/** As `playerAccepts`, with the player's email (to seed their history). */
export async function linkedPlayer(
  cast: Cast,
  { link, name, group }: { link: string; name: string; group?: string },
): Promise<Player> {
  const context = await newDevice(cast.browser);
  cast.devices.push(context);
  const page = await context.newPage();
  const email = await newOnboardedAccount(page, cast.request, name);
  await page.goto(link);
  await expectInviteFrom(page, cast.messages, {
    coach: COACH,
    ...(group === undefined ? {} : { group }),
  });
  await acceptInvite(page, cast.messages);
  await page.goto('/');
  return { page, email };
}

/** On Today: the row of `name` from the coach, with `deadline` (a day) or none. */
export async function expectAssigned(
  page: Page,
  cast: Cast,
  name: string,
  deadline: string | null,
): Promise<void> {
  const t = cast.messages.assignment;
  const item = todayRow(page, cast.messages, name);
  await expect(item).toBeVisible();
  await expect(
    item.getByText(format(t.page.assignedBy, { name: COACH })),
  ).toBeVisible();
  if (deadline === null) {
    const prefix = format(t.deadlineOn, { date: '' }).trim();
    await expect(item.getByText(prefix)).toHaveCount(0);
  } else {
    const text = deadlineText(cast.messages, deadline);
    await expect(item.getByText(text, { exact: true })).toBeVisible();
  }
}

/**
 * On the coach's Repertoire screen: moving the group's deadline to
 * `day`, already past, is refused and says so (R-210).
 */
export async function expectPastDeadlineRefused(
  coach: Page,
  messages: Messages,
  day: string,
): Promise<void> {
  const t = messages.assignment.panel;
  // The group's one row: its Change changes the group's deadline.
  const row = assignmentRow(coach, messages, GROUP);
  await openChange(row, messages);
  await row.getByLabel(t.deadlineLabel, { exact: true }).fill(day);
  await row.getByRole('button', { name: t.saveDeadline }).click();
  await expect(
    row.getByText(messages.assignment.deadlinePast, { exact: true }),
  ).toBeVisible();
}

/** The coach removes `name` from the group (`member` false) or adds them. */
export async function setInGroup(
  coach: Page,
  messages: Messages,
  { name, member }: { name: string; member: boolean },
): Promise<void> {
  const t = messages.coach.group;
  await coach.goto('/coach');
  await coach.getByRole('link', { name: GROUP, exact: true }).click();
  await expect(coach).toHaveURL(/\/coach\/groups\//);
  // "Players · N": its name carries its count, so it is matched from its
  // start; its list holds the members (the picker's options are not in it).
  const section = coach.getByRole('region', {
    name: new RegExp(`^${messages.coach.players.title} · `, 'u'),
  });
  const members = section.getByRole('list');
  if (member) {
    // Add a player opens the picker inline (#381).
    await section
      .getByRole('button', { name: t.addTitle, exact: true })
      .click();
    await section
      .getByLabel(t.addLabel, { exact: true })
      .selectOption({ label: name });
    await section.getByRole('button', { name: t.add, exact: true }).click();
    await expect(members.getByText(name, { exact: true })).toBeVisible();
  } else {
    // Remove asks first (#329): the member's row holds both steps.
    const row = members.getByRole('listitem').filter({
      has: coach.getByText(name, { exact: true }),
    });
    await row.getByRole('button', { name: t.remove, exact: true }).click();
    await row
      .getByRole('button', { name: t.confirmRemove, exact: true })
      .click();
    await expect(members.getByText(name, { exact: true })).toHaveCount(0);
  }
}
