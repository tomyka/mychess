// Repertoire steps for the E2E journeys: My repertoires, the repertoire
// page's chapter list and move list, and the import flow.
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { format, LOCALE, type Messages } from './journey';
import { openTab } from './nav';

/**
 * A catalogue message with ICU `plural`s (and plain placeholders), as the
 * app renders it.
 */
export function plural(
  message: string,
  values: Readonly<Record<string, number | string>>,
): string {
  const rules = new Intl.PluralRules(LOCALE);
  const text = message.replace(
    /\{(\w+), plural, ((?:[=\w]+ \{[^{}]*\}\s*)+)\}/g,
    (_whole, name: string, branches: string) => {
      const count = Number(values[name]);
      const options = new Map(
        [...branches.matchAll(/([=\w]+) \{([^{}]*)\}/g)].map(
          (match) => [match[1] ?? '', match[2] ?? ''] as const,
        ),
      );
      const branch =
        options.get(`=${String(count)}`) ??
        options.get(rules.select(count)) ??
        options.get('other') ??
        '';
      return branch.replace('#', String(count));
    },
  );
  return format(
    text,
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, String(value)]),
    ),
  );
}

/**
 * A catalogue message with any count, as a whole-text pattern: both its
 * `one` and `other` branches with the number free (a message without a
 * plural matches only itself).
 */
export function anyCount(message: string): RegExp {
  const branches = [1, 2].map((count) =>
    plural(message, { count })
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(String(count), '\\d+'),
  );
  return new RegExp(`^(?:${branches.join('|')})$`);
}

/** From any shell page to My repertoires, through the tab. */
export async function openRepertoires(
  page: Page,
  messages: Messages,
): Promise<void> {
  await openTab(page, messages, 'repertoires');
  await expect(page).toHaveURL(/\/repertoires$/);
}

/** Creates a repertoire from My repertoires; it opens in builder mode. */
export async function createRepertoire(
  page: Page,
  messages: Messages,
  { name, side }: { name: string; side: 'white' | 'black' },
): Promise<void> {
  const t = messages.repertoires.create;
  await page.getByLabel(t.name, { exact: true }).fill(name);
  await page.getByRole('radio', { name: t[side] }).check();
  await page.getByRole('button', { name: t.submit }).click();
  await expect(page).toHaveURL(/\/repertoires\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  // Plan decision 18: a new, empty repertoire opens in builder mode.
  await expect(
    page.getByRole('switch', { name: messages.repertoires.mode.build }),
  ).toHaveAttribute('aria-checked', 'true');
}

/**
 * From a repertoire's page (own or assigned) to its Repertoire screen
 * (R-226), through the top bar's More link; it is titled with the name.
 */
export async function openRepertoireOptions(
  page: Page,
  messages: Messages,
): Promise<void> {
  const name = await page.getByRole('heading', { level: 1 }).textContent();
  await page
    .getByRole('link', { name: messages.repertoires.more, exact: true })
    .click();
  await expect(page).toHaveURL(/\/manage(\?|$)/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name ?? '');
}

/** From a Repertoire screen back to the repertoire `name`, by its back link. */
export async function backToRepertoire(
  page: Page,
  messages: Messages,
  name: string,
): Promise<void> {
  await page
    .getByRole('link', { name: format(messages.nav.back, { parent: name }) })
    .click();
  await expect(page).toHaveURL(/\/repertoires\/(assigned\/)?[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

/** The move list chip whose accessible name is exactly `name` ("2. Bf4"). */
export const chip = (page: Page, name: string): Locator =>
  page.getByRole('button', { name, exact: true }).first();

/** Plays `san` through the typed-move field; it becomes the current move. */
export async function typeMove(
  page: Page,
  messages: Messages,
  san: string,
): Promise<void> {
  const field = page.getByLabel(messages.board.moveInput.label, {
    exact: true,
  });
  await field.fill(san);
  await field.press('Enter');
  await expect(field).toHaveValue('');
  await expect(
    page.locator('button[aria-current="true"]', { hasText: san }),
  ).toBeVisible();
}

/**
 * The chapter line ("Ch 2/6 · <title>"), the disclosure of the chapter
 * list. It is the one disclosure titled with its own text: the account
 * menu (#381) carries an aria-label, and Train here's "I know this" and
 * the comment strip's More carry no title.
 */
export const disclosure = (page: Page): Locator =>
  page.locator('button[aria-controls][aria-expanded][title]').first();

/** The chapter line's lead, "Ch 2/6 ·", without the chapter's title. */
export const chapterLine = (
  messages: Messages,
  index: number,
  count: number,
): string =>
  format(messages.repertoires.chapters.line, {
    index: String(index),
    count: String(count),
    title: '',
  }).trim();

/**
 * Opens the chapter list if closed; the open list. Right after a reload a
 * click can land before the page hydrates and be lost, so opening is
 * retried until the line says it is open.
 */
export async function openChapters(page: Page): Promise<Locator> {
  const trigger = disclosure(page);
  await expect(async () => {
    if ((await trigger.getAttribute('aria-expanded')) === 'false')
      await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true', {
      timeout: 1_000,
    });
  }).toPass();
  return page.locator(
    `[id="${String(await trigger.getAttribute('aria-controls'))}"]`,
  );
}

/** What keeps a move's number and its SAN on one line in a chapter title. */
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);

/**
 * A chapter's title when another chapter shares its name (R-158): `name`
 * with its ECO code and the move where it parts from the others, given as
 * "6. Be3".
 */
export function distinctTitle(
  messages: Messages,
  { name, eco, move }: { name: string; eco: string; move: string },
): string {
  return format(messages.chapter.distinct, {
    name,
    eco,
    move: move.replace(' ', NO_BREAK_SPACE),
  });
}

/** Opens the chapter list if closed and chooses row `index` titled `title`. */
export async function chooseChapter(
  page: Page,
  title: string,
  index = 0,
): Promise<void> {
  const list = await openChapters(page);
  await list
    .getByRole('button', { name: title, exact: true })
    .nth(index)
    .click();
  await expect(disclosure(page)).toContainText(title);
}

/**
 * Opens the chapter list and chooses its `index`th row (from 0); the list
 * closes, the line names that chapter.
 */
export async function chooseChapterAt(
  page: Page,
  index: number,
): Promise<void> {
  const list = await openChapters(page);
  const row = list.getByRole('listitem').nth(index).getByRole('button');
  const title = (await row.first().getAttribute('aria-label')) ?? '';
  await row.first().click();
  await expect(disclosure(page)).toContainText(title);
}

/** Train here (spec, "Train here (browse)"), under the move list. */
export const trainHere = (page: Page, messages: Messages): Locator =>
  page.getByRole('region', { name: messages.training.know.section });

/**
 * Opens Train here's "I know this"; its choice named `subject` ("This
 * move, 5... Qc7", or a pattern such as `anyCount(know.chapter)` for
 * "This chapter, 12 moves"), once it has counted.
 */
export async function knowChoice(
  page: Page,
  messages: Messages,
  subject: string | RegExp,
): Promise<Locator> {
  const t = messages.training.know;
  const toggle = trainHere(page, messages).getByRole('button', {
    name: t.iKnowThis,
    exact: true,
  });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  const choice = trainHere(page, messages).getByRole('group', {
    name: subject,
    exact: true,
  });
  await expect(choice.getByText(t.loading)).toHaveCount(0);
  return choice;
}

/**
 * Uploads `file` (as `side`, unless the side is fixed) and asks for the
 * preview. A file set before the page hydrates is lost (the flow keeps it
 * in React state), so it is set again until the page names it; the side is
 * chosen after that, on the hydrated page.
 */
export async function previewImport(
  page: Page,
  messages: Messages,
  { file, side }: { file: string; side?: 'white' | 'black' },
): Promise<void> {
  const t = messages.repertoires;
  await expect(page).toHaveURL(/\/repertoires\/import/);
  const chosen = format(t.import.fileChosen, {
    name: basename(file),
    size: String(Math.ceil((await stat(file)).size / 1024)),
  });
  await expect(async () => {
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.getByText(chosen, { exact: true })).toBeVisible({
      timeout: 1_000,
    });
  }).toPass();
  if (side !== undefined)
    await page.getByRole('radio', { name: t.create[side] }).check();
  await page.getByRole('button', { name: t.import.preview }).click();
}

/** What the import summary counts. */
export interface SummaryCounts {
  readonly chapters: number;
  readonly lines: number;
  readonly transpositions: number;
  readonly moves: number;
}

/** The stats line's order; transpositions only when there are some. */
const COUNTS = ['chapters', 'lines', 'moves', 'transpositions'] as const;

/** The summary's one stats line reads `counts`. */
export async function expectSummary(
  page: Page,
  messages: Messages,
  counts: SummaryCounts,
): Promise<void> {
  const t = messages.repertoires.import;
  await expect(
    page.getByRole('heading', { name: t.summaryTitle }),
  ).toBeVisible();
  const line = COUNTS.filter(
    (key) => key !== 'transpositions' || counts[key] > 0,
  )
    .map((key) => plural(t.summary[key], { count: counts[key] }))
    .join(' · ');
  await expect(page.getByText(line, { exact: true })).toBeVisible();
}

/** The screen-reader text of a move's one arrow. */
export function arrowText(
  messages: Messages,
  { from, to }: { from: string; to: string },
): string {
  const t = messages.repertoires;
  return format(t.panel.arrows, {
    list: format(t.panel.arrow, { from, to, color: t.colors.G }),
  });
}
