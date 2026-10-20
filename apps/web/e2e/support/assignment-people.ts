// The people of the S5 journeys (plan Task C8): the coach and his players
// (docs/personas/coach.md), each on a device of their own and in the test's
// language, and the coach's group steps the journeys repeat.
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { assignmentRow, deadlineText, homeAssignment } from './assignments';
import { acceptInvite, expectInviteFrom, switchOnCoachMode } from './coaching';
import {
  chooseEnglish,
  format,
  newDevice,
  newOnboardedAccount,
  type Locale,
  type Messages,
} from './journey';

export const COACH = 'Rimantas Vaitkus';
export const GROUP = 'Šeštadienio grupė';
export const ROKAS = 'Rokas Petrauskas';
export const GABIJA = 'Gabija Navickaitė';
export const DOVYDAS = 'Dovydas Jankauskas';
/** The fourth, unseeded member who takes the group invite later. */
export const FOURTH = 'Austėja Žukauskaitė';

/** One journey's language and the devices it opened, closed at its end. */
export interface Cast {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly browser: Browser;
  readonly request: APIRequestContext;
  readonly devices: BrowserContext[];
}

/** A new account named `name`, onboarded and then in `locale`, on home. */
async function account(
  page: Page,
  request: APIRequestContext,
  name: string,
  locale: Locale,
): Promise<void> {
  await newOnboardedAccount(page, request, name);
  if (locale === 'en') await chooseEnglish(page);
}

/** The coach on `page`, Coach mode on, on the coach dashboard. */
export async function coachReady(page: Page, cast: Cast): Promise<void> {
  await account(page, cast.request, COACH, cast.locale);
  await switchOnCoachMode(page, cast.messages);
  await page.goto('/treneris');
}

/** A new player on a device of their own who accepts `link`; on home. */
export async function playerAccepts(
  cast: Cast,
  { link, name, group }: { link: string; name: string; group?: string },
): Promise<Page> {
  const context = await newDevice(cast.browser);
  cast.devices.push(context);
  const page = await context.newPage();
  await account(page, cast.request, name, cast.locale);
  await page.goto(link);
  await expectInviteFrom(page, cast.messages, {
    coach: COACH,
    ...(group === undefined ? {} : { group }),
  });
  await acceptInvite(page, cast.messages);
  await page.goto('/');
  return page;
}

/** On home: `name` from the coach, with `deadline` (a day) or none. */
export async function expectAssigned(
  page: Page,
  cast: Cast,
  name: string,
  deadline: string | null,
): Promise<void> {
  const t = cast.messages.assignment;
  const item = homeAssignment(page, cast.messages, name);
  await expect(item).toBeVisible();
  await expect(
    item.getByText(format(t.page.assignedBy, { name: COACH })),
  ).toBeVisible();
  if (deadline === null) {
    const prefix = format(t.deadlineOn, { date: '' }).trim();
    await expect(item.getByText(prefix)).toHaveCount(0);
  } else {
    const text = deadlineText(cast.messages, cast.locale, deadline);
    await expect(item.getByText(text, { exact: true })).toBeVisible();
  }
}

/** On the coach's repertoire page: the group row's deadline moves to `day`. */
export async function changeGroupDeadline(
  coach: Page,
  messages: Messages,
  day: string,
): Promise<void> {
  const t = messages.assignment.panel;
  const row = assignmentRow(coach, messages, GROUP);
  await row.getByLabel(t.newDeadline, { exact: true }).fill(day);
  await row.getByRole('button', { name: t.changeDeadline }).click();
  await expect(row.getByText(t.deadlineSaved, { exact: true })).toBeVisible();
}

/** The coach removes `name` from the group (`member` false) or adds them. */
export async function setInGroup(
  coach: Page,
  messages: Messages,
  { name, member }: { name: string; member: boolean },
): Promise<void> {
  const t = messages.coach.group;
  await coach.goto('/treneris');
  await coach.getByRole('link', { name: GROUP, exact: true }).click();
  await expect(coach).toHaveURL(/\/treneris\/grupes\//);
  const members = coach.getByRole('region', { name: t.membersTitle });
  if (member) {
    await coach
      .getByLabel(t.addLabel, { exact: true })
      .selectOption({ label: name });
    await coach.getByRole('button', { name: t.add, exact: true }).click();
    await expect(members.getByText(name, { exact: true })).toBeVisible();
  } else {
    await coach
      .getByRole('button', { name: format(t.removeNamed, { name }) })
      .click();
    await expect(members.getByText(name, { exact: true })).toHaveCount(0);
  }
}
