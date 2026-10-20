// Assignment steps for the S5 E2E journeys (plan Task C8): importing the
// coach's repertoires, the assign panel, "From my coach" and fork offers on
// home, and the dates they show.
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';
import { format, type Locale, type Messages } from './journey';
import { previewImport } from './repertoires';

/** A PGN under e2e/fixtures. */
export const fixture = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/** The zone deadlines are counted and shown in (src/lib/time-zone.ts). */
const VILNIUS = 'Europe/Vilnius';

/** Today in Vilnius moved by `days`, as `YYYY-MM-DD` (plan decision 10). */
export function vilniusDay(days = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: VILNIUS,
  }).format(new Date());
  const moved = new Date(`${today}T12:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** A deadline as the app writes it in `locale` (src/app/use-deadline.ts). */
export function deadlineText(
  messages: Messages,
  locale: Locale,
  day: string,
): string {
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: VILNIUS,
  }).format(new Date(`${day}T12:00:00Z`));
  return format(messages.assignment.deadlineOn, { date });
}

/** Imports `file` as a new repertoire `name`; returns its page URL. */
export async function importRepertoire(
  page: Page,
  messages: Messages,
  { file, side, name }: { file: string; side: 'white' | 'black'; name: string },
): Promise<string> {
  const t = messages.repertoires.import;
  // A file chosen before the page hydrates is lost ("choose a file"), and
  // choosing the same file again fires no change, so the page is loaded
  // afresh for each try until the preview's name field shows.
  const field = page.getByLabel(t.name, { exact: true });
  await expect(async () => {
    await page.goto('/repertuarai/importuoti');
    await previewImport(page, messages, { file, side });
    await expect(field).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await field.fill(name);
  await page.getByRole('button', { name: t.confirm, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  return page.url();
}

/** The coach's assign panel on their repertoire page. */
const assignPanel = (page: Page, messages: Messages): Locator =>
  page.getByRole('region', { name: messages.assignment.panel.title });

/** One row of the panel's list: the assignment to `target`. */
export const assignmentRow = (
  page: Page,
  messages: Messages,
  target: string,
): Locator =>
  assignPanel(page, messages)
    .getByRole('listitem')
    .filter({
      has: page.getByRole('heading', { level: 4, name: target, exact: true }),
    });

/** In the assign panel: assigns to `target` (a player or a group). */
export async function assignTo(
  page: Page,
  messages: Messages,
  { target, deadline }: { target: string; deadline?: string },
): Promise<void> {
  const t = messages.assignment.panel;
  const panel = assignPanel(page, messages);
  await panel
    .getByLabel(t.target, { exact: true })
    .selectOption({ label: target });
  if (deadline !== undefined)
    await panel.getByLabel(t.deadline, { exact: true }).fill(deadline);
  await panel.getByRole('button', { name: t.assign, exact: true }).click();
  // Not "Assigned.": that status goes with the form once no one is left
  // to assign to. The new row is what shows it saved.
  await expect(assignmentRow(page, messages, target)).toBeVisible();
}

/** "From my coach" on home. */
export const fromMyCoach = (page: Page, messages: Messages): Locator =>
  page.getByRole('region', { name: messages.assignment.home.title });

/** One assignment under "From my coach", found by its link. */
export const homeAssignment = (
  page: Page,
  messages: Messages,
  name: string,
): Locator =>
  fromMyCoach(page, messages)
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name, exact: true }) });

/** The open fork offers on home. */
export const forkOffers = (page: Page, messages: Messages): Locator =>
  page.getByRole('region', { name: messages.forkOffer.title });

/** A badge (`assignment.badge.*`) inside `scope`. */
export const badge = (
  scope: Locator,
  messages: Messages,
  flag: keyof Messages['assignment']['badge'],
): Locator => scope.getByText(messages.assignment.badge[flag], { exact: true });

/**
 * Reloads `page` until `check` passes: what changed on another account's
 * request (or in a fire-and-forget action) shows on the next request.
 */
export async function untilAfterReload(
  page: Page,
  check: () => Promise<void>,
): Promise<void> {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 20_000 });
}
