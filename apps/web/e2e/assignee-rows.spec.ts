// #381 (plan Task 14, step 2): the coach's assignee rows on his Repertoire
// screen (R-225, R-226), docs/personas/coach.md. Rimantas assigns the
// Italian to Rokas on his own and to the Saturday group (Gabija); in
// Rokas's row, Change sets a deadline and clears it (R-51; the date field
// starts today, R-203) and Unassign asks first (R-130); in Gabija's row,
// "Change for <group>" starts with the group's own deadline (R-16).
import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  GABIJA,
  GROUP,
  ROKAS,
  coachReady,
  expectAssigned,
  playerAccepts,
  type Cast,
} from './support/assignment-people';
import {
  assignmentRow,
  assignTo,
  groupRows,
  importRepertoire,
  openChange,
  untilAfterReload,
  vilniusDay,
} from './support/assignments';
import { createGroup, createInvite } from './support/coaching';
import { en, format, LOCALE, test } from './support/journey';
import { todayRow } from './support/today';
import { ITALIAN, ITALIAN_PGN } from './support/training-cast';

const t = en.assignment.panel;

/**
 * A day as a row writes it (src/lib/date-format.ts shortDateFormat):
 * "Dec 6", with the year only when it is not this year in Vilnius.
 */
function shortDay(day: string): string {
  const thisYear = vilniusDay(0).slice(0, 4);
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: 'Europe/Vilnius',
    month: 'short',
    day: 'numeric',
    ...(day.startsWith(thisYear) ? {} : { year: 'numeric' }),
  }).format(new Date(`${day}T12:00:00Z`));
}

/** The row's deadline: "due Dec 6", or that there is none. */
const rowDeadline = (row: Locator, day: string | null): Locator =>
  row.getByText(
    day === null
      ? en.assignment.noDeadline
      : format(t.due, { date: shortDay(day) }),
    { exact: true },
  );

/** In Rokas's own row: a deadline set, then cleared; his Today follows. */
async function changeAndClear(
  row: Locator,
  cast: Cast,
  rokas: Page,
): Promise<void> {
  const day = vilniusDay(10);
  await expect(rowDeadline(row, null)).toBeVisible();
  await openChange(row, en);
  // No deadline yet: nothing to clear.
  await expect(
    row.getByRole('button', { name: t.clearDeadline, exact: true }),
  ).toHaveCount(0);
  const field = row.getByLabel(t.newDeadline, { exact: true });
  await expect(field).toHaveAttribute('min', vilniusDay(0));
  await field.fill(day);
  await row
    .getByRole('button', { name: t.changeDeadline, exact: true })
    .click();
  await expect(row.getByText(t.deadlineSaved, { exact: true })).toBeVisible();
  await expect(rowDeadline(row, day)).toBeVisible();
  await rokas.reload();
  await expectAssigned(rokas, cast, ITALIAN, day);

  await row.getByRole('button', { name: t.clearDeadline, exact: true }).click();
  await expect(rowDeadline(row, null)).toBeVisible();
  await expect(
    row.getByRole('button', { name: t.clearDeadline, exact: true }),
  ).toHaveCount(0);
  await rokas.reload();
  await expectAssigned(rokas, cast, ITALIAN, null);
}

/** Unassign asks first; Keep it keeps the row, Unassign removes it. */
async function unassign(row: Locator, rokas: Page): Promise<void> {
  const first = row.getByRole('button', { name: t.unassign, exact: true });
  const keep = row.getByRole('button', { name: t.unassignCancel, exact: true });
  await first.click();
  await expect(keep).toBeVisible();
  await keep.click();
  await expect(keep).toHaveCount(0);
  await first.click();
  await row
    .getByRole('button', { name: t.unassignConfirm, exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await untilAfterReload(rokas, async () => {
    await expect(todayRow(rokas, en, ITALIAN)).toHaveCount(0, {
      timeout: 2_000,
    });
  });
}

/**
 * Gabija's row through the group: her deadline in the row, and the group's
 * own at the top of "Change for <group>", which clears it.
 */
async function groupDeadline(row: Locator, day: string): Promise<void> {
  await expect(rowDeadline(row, day)).toBeVisible();
  await openChange(row, en, GROUP);
  await expect(
    row.getByText(format(t.groupDeadline, { date: shortDay(day) }), {
      exact: true,
    }),
  ).toBeVisible();
  await row.getByRole('button', { name: t.clearDeadline, exact: true }).click();
  await expect(row.getByText(t.groupNoDeadline, { exact: true })).toBeVisible();
  await expect(rowDeadline(row, null)).toBeVisible();
}

test('#381, R-225: the coach changes and clears a player’s deadline, unassigns him, and a group row’s Change starts with the group’s deadline', async ({
  page: coach,
  request,
  browser,
}) => {
  test.setTimeout(300_000);
  const devices: BrowserContext[] = [];
  const cast: Cast = { messages: en, browser, request, devices };
  try {
    await coachReady(coach, cast);
    const personal = await createInvite(coach, en, { kind: 'personal' });
    const rokas = await playerAccepts(cast, { link: personal, name: ROKAS });
    const group = await createGroup(coach, en, GROUP);
    await playerAccepts(cast, { link: group, name: GABIJA, group: GROUP });
    await importRepertoire(coach, en, {
      file: ITALIAN_PGN,
      side: 'white',
      name: ITALIAN,
    });
    const groupDay = vilniusDay(30);
    await assignTo(coach, en, { target: ROKAS });
    await assignTo(coach, en, { target: GROUP, deadline: groupDay });
    await rokas.reload();
    await expectAssigned(rokas, cast, ITALIAN, null);

    const own = assignmentRow(coach, en, ROKAS);
    await changeAndClear(own, cast, rokas);
    await unassign(own, rokas);
    await groupDeadline(groupRows(coach, en, GROUP).first(), groupDay);
  } finally {
    for (const device of devices) await device.close();
  }
});
