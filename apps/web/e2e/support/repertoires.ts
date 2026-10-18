// Repertoire steps for the E2E journeys: Mano repertuarai, the repertoire
// page's chapter list and move list, and the import flow.
import { expect, type Locator, type Page } from '@playwright/test';
import { format, type Locale, type Messages } from './journey';

/**
 * A catalogue message with ICU `plural`s (and plain placeholders), as the
 * app renders it in `locale`.
 */
export function plural(
  message: string,
  locale: Locale,
  values: Readonly<Record<string, number | string>>,
): string {
  const rules = new Intl.PluralRules(locale);
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

/** From home to Mano repertuarai. */
export async function openRepertoires(
  page: Page,
  messages: Messages,
): Promise<void> {
  await page.getByRole('link', { name: messages.app.repertoires }).click();
  await expect(page).toHaveURL(/\/repertuarai$/);
}

/** Creates a repertoire from Mano repertuarai; it opens in builder mode. */
export async function createRepertoire(
  page: Page,
  messages: Messages,
  { name, side }: { name: string; side: 'white' | 'black' },
): Promise<void> {
  const t = messages.repertoires.create;
  await page.getByLabel(t.name, { exact: true }).fill(name);
  await page.getByRole('radio', { name: t[side] }).check();
  await page.getByRole('button', { name: t.submit }).click();
  await expect(page).toHaveURL(/\/repertuarai\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  // Plan decision 18: a new, empty repertoire opens in builder mode.
  await expect(
    page.getByRole('switch', { name: messages.repertoires.mode.build }),
  ).toHaveAttribute('aria-checked', 'true');
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

/** The chapter disclosure ("Chapter n of m" and the title). */
export const disclosure = (page: Page): Locator =>
  page.locator('button[aria-controls][aria-expanded]').first();

/** Opens the chapter list if closed and chooses row `index` titled `title`. */
export async function chooseChapter(
  page: Page,
  title: string,
  index = 0,
): Promise<void> {
  const trigger = disclosure(page);
  if ((await trigger.getAttribute('aria-expanded')) === 'false')
    await trigger.click();
  await page
    .getByRole('button', { name: title, exact: true })
    .nth(index)
    .click();
  await expect(trigger).toContainText(title);
}

/** Uploads `file` (as `side`, unless the side is fixed) and asks for the preview. */
export async function previewImport(
  page: Page,
  messages: Messages,
  { file, side }: { file: string; side?: 'white' | 'black' },
): Promise<void> {
  const t = messages.repertoires;
  await expect(page).toHaveURL(/\/repertuarai\/importuoti/);
  await page.locator('input[type="file"]').setInputFiles(file);
  if (side !== undefined)
    await page.getByRole('radio', { name: t.create[side] }).check();
  await page.getByRole('button', { name: t.import.preview }).click();
}

/** What the import summary counts. */
export interface SummaryCounts {
  readonly chapters: number;
  readonly lines: number;
  readonly positions: number;
  readonly transpositions: number;
  readonly moves: number;
}

const COUNTS = [
  'chapters',
  'lines',
  'positions',
  'transpositions',
  'moves',
] as const;

/** The five summary tiles read `counts`. */
export async function expectSummary(
  page: Page,
  messages: Messages,
  locale: Locale,
  counts: SummaryCounts,
): Promise<void> {
  const t = messages.repertoires.import;
  await expect(
    page.getByRole('heading', { name: t.summaryTitle }),
  ).toBeVisible();
  for (const key of COUNTS)
    await expect(
      page.getByText(plural(t.summary[key], locale, { count: counts[key] }), {
        exact: true,
      }),
    ).toBeVisible();
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
