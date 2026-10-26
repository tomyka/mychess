// The S6 journeys' repertoires and the screens they pass through (plan
// Task D3): the PGN fixtures as the books a drill answers from, the
// repertoire page's train links and "I know this" menus, home's Today block
// and the done summary.
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { fixture, importRepertoire } from './assignments';
import {
  CATALOGUES,
  format,
  newOnboardedAccount,
  type Locale,
  type Messages,
} from './journey';
import { disclosure, plural } from './repertoires';
import {
  bookOf,
  drillToDone,
  expectCounter,
  setTrainingLimits,
  type Asked,
  type Drill,
} from './training';

const { lt } = CATALOGUES;

export const ITALIAN = 'Itališkoji partija';
export const CATALAN = 'Katalonų pradžia';
export const CATALAN_A4 = 'Katalonų pradžia: 8.a4 sistema';
export const BACKLOG = 'Visas repertuaras';

/**
 * Rokas's eight Italian lines (docs/personas/u1400.md): the Giuoco
 * Pianissimo first, then the Two Knights that transposes into it.
 */
const ITALIAN_PGN = fixture('italiskoji.pgn');
/** Dovydas's four Catalan lines (docs/personas/2000plus.md). */
export const CATALAN_PGN = fixture('katalonu.pgn');
/** His 8.a4 system, a second White answer to 7...a6 (R-54). */
export const CATALAN_A4_PGN = fixture('katalonu-a4.pgn');
/**
 * A White repertoire of 14 lines after 1.d4 with 211 own moves, one
 * answer per position (generated, then proven legal by bookOf), for the
 * backlog journeys: Dovydas's real files are several times the persona's.
 */
export const BACKLOG_PGN = fixture('backlog.pgn');

export const italian = bookOf(ITALIAN_PGN, 'white', ITALIAN);
export const catalan = bookOf(CATALAN_PGN, 'white', CATALAN);
export const catalanA4 = bookOf(CATALAN_A4_PGN, 'white', CATALAN_A4);
export const backlog = bookOf(BACKLOG_PGN, 'white', BACKLOG);

/** The repertoire page's "Learn (n)" and "Review (n)" links. */
export const trainLink = (
  page: Page,
  messages: Messages,
  kind: 'learn' | 'review',
  count: number,
): Locator =>
  page.getByRole('link', {
    name: format(messages.training.repertoire[kind], {
      count: String(count),
    }),
    exact: true,
  });

/** Home's Today block. */
export const today = (page: Page, messages: Messages): Locator =>
  page.getByRole('region', { name: messages.training.today.title });

/** Home's due line: `count` due, about `minutes` (8 s a move, rounded up). */
export const dueLine = (locale: Locale, count: number): string =>
  plural(CATALOGUES[locale].training.today.due, locale, {
    count,
    minutes: Math.ceil((count * 8) / 60),
  });

/** From home, starts today's review of every repertoire. */
export async function startTodayReview(
  page: Page,
  messages: Messages,
): Promise<void> {
  await today(page, messages)
    .getByRole('link', { name: messages.training.today.start, exact: true })
    .click();
  await expect(page).toHaveURL(/\/treniruote\?mode=review$/);
}

/** A done summary's number under `label`. */
export const stat = (page: Page, label: string): Locator =>
  page.locator('dl > div').filter({ hasText: label }).locator('dd');

/** The arrow chessground draws for the move asked. */
export const arrow = (page: Page): Locator =>
  page.locator('cg-container svg.cg-shapes line');

/** A new Rokas with eight new moves a day and the Italian imported; his email. */
export async function rokasWithItalian(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  const email = await newOnboardedAccount(page, request, 'Rokas Petrauskas');
  // Eight new moves a day: one session teaches exactly the Pianissimo.
  await setTrainingLimits(page, lt, { newPerDay: 8 });
  await importRepertoire(page, lt, {
    file: ITALIAN_PGN,
    side: 'white',
    name: ITALIAN,
  });
  return email;
}

/** On the Italian's page: learns its first line, typed, to the done summary. */
export async function learnPianissimo(drill: Drill): Promise<Asked[]> {
  const { page } = drill;
  await trainLink(page, lt, 'learn', 8).click();
  await expect(page).toHaveURL(/\/treniruote\?mode=learn&r=/);
  await expectCounter(page, 0, 8);
  const asked = await drillToDone(drill);
  await expect(stat(page, lt.training.done.learned)).toHaveText('8');
  return asked;
}

/** In an open "I know this" menu: marks its chapter known; the count asked. */
async function markKnown(
  body: Locator,
  messages: Messages,
  locale: Locale,
): Promise<number | null> {
  const t = messages.training.know;
  await expect(body.getByText(t.loading)).toHaveCount(0);
  const know = body.getByRole('button', { name: t.knowChapter });
  if ((await know.count()) === 0) return null;
  await know.click();
  const question = (await body.getByText(/\?/).textContent()) ?? '';
  const count = Number(/\d+/.exec(question)?.[0]);
  // R-147: the confirm says how many moves.
  expect(question).toBe(plural(t.question, locale, { count }));
  await body.getByRole('button', { name: t.confirm, exact: true }).click();
  await expect(
    body.getByText(plural(t.marked, locale, { count }), { exact: true }),
  ).toBeVisible();
  return count;
}

/** Opens the chapter list and marks every chapter known; the counts confirmed. */
export async function markChaptersKnown(
  page: Page,
  messages: Messages,
  locale: Locale,
): Promise<number[]> {
  const trigger = disclosure(page);
  if ((await trigger.getAttribute('aria-expanded')) === 'false')
    await trigger.click();
  const list = page.locator(
    `[id="${String(await trigger.getAttribute('aria-controls'))}"]`,
  );
  const toggles = list.getByRole('button', {
    name: format(messages.training.know.toggle, { subject: '' }),
  });
  const counts: number[] = [];
  const chapters = await toggles.count();
  for (let i = 0; i < chapters; i += 1) {
    const toggle = toggles.nth(i);
    await toggle.click();
    const body = list.locator(
      `[id="${String(await toggle.getAttribute('aria-controls'))}"]`,
    );
    const count = await markKnown(body, messages, locale);
    if (count !== null) counts.push(count);
  }
  return counts;
}
