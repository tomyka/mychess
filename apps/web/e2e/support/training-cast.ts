// The S6 journeys' repertoires and the screens they pass through (plan
// Task D3): the PGN fixtures as the books a drill answers from, the
// repertoire page's train links and "I know this" menus, and the done
// summary. Today's hero and rows are in ./today.
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { fixture, importRepertoire } from './assignments';
import { en, format, newOnboardedAccount, type Messages } from './journey';
import {
  anyCount,
  chooseChapterAt,
  knowChoice,
  openChapters,
  plural,
} from './repertoires';
import {
  bookOf,
  drillToDone,
  expectCounter,
  setTrainingLimits,
  type Asked,
  type Drill,
} from './training';

export const ITALIAN = 'Itališkoji partija';
export const CATALAN = 'Katalonų pradžia';
export const CATALAN_A4 = 'Katalonų pradžia: 8.a4 sistema';
export const BACKLOG = 'Visas repertuaras';
export const KARO_KAN = 'Karo-Kan gynyba: pagrindai';

/**
 * Rokas's eight Italian lines (docs/personas/u1400.md): the Giuoco
 * Pianissimo first, then the Two Knights that transposes into it.
 */
export const ITALIAN_PGN = fixture('italiskoji.pgn');
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
/** The coach's five Caro-Kann lines (Black, docs/personas/coach.md). */
export const KARO_KAN_PGN = fixture('karo-kan.pgn');

export const italian = bookOf(ITALIAN_PGN, 'white', ITALIAN);
export const catalan = bookOf(CATALAN_PGN, 'white', CATALAN);
export const catalanA4 = bookOf(CATALAN_A4_PGN, 'white', CATALAN_A4);
export const backlog = bookOf(BACKLOG_PGN, 'white', BACKLOG);
export const karoKan = bookOf(KARO_KAN_PGN, 'black', KARO_KAN);

/** The repertoire page's "Learn n today" and "Review n" links (summary line). */
export const trainLink = (
  page: Page,
  messages: Messages,
  kind: 'learn' | 'review',
  count: number,
): Locator =>
  page.getByRole('link', {
    name: format(
      kind === 'learn'
        ? messages.repertoires.summary.learnToday
        : messages.repertoires.summary.review,
      { count: String(count) },
    ),
    exact: true,
  });

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
  await setTrainingLimits(page, en, { newPerDay: 8 });
  await importRepertoire(page, en, {
    file: ITALIAN_PGN,
    side: 'white',
    name: ITALIAN,
  });
  return email;
}

/** On the Italian's page: learns its first line, typed, to the done summary. */
export async function learnPianissimo(drill: Drill): Promise<Asked[]> {
  const { page } = drill;
  await trainLink(page, en, 'learn', 8).click();
  await expect(page).toHaveURL(/\/training\?mode=learn&r=/);
  await expectCounter(page, 0, 8);
  const asked = await drillToDone(drill);
  await expect(stat(page, en.training.done.learned)).toHaveText('8');
  return asked;
}

/**
 * In Train here's "I know this": marks the current chapter known, through
 * its Mark known and the confirm that says how many moves (R-147); the
 * count, or null when the chapter has nothing left to mark.
 */
async function markKnown(
  page: Page,
  messages: Messages,
): Promise<number | null> {
  const t = messages.training.know;
  const choice = await knowChoice(page, messages, anyCount(t.chapter));
  const mark = choice.getByRole('button', { name: anyCount(t.markKnown) });
  if ((await mark.count()) === 0) return null;
  const label = (await mark.textContent()) ?? '';
  const count = Number(/\d+/.exec(label)?.[0]);
  expect(label).toBe(plural(t.markKnown, { count }));
  await mark.click();
  // R-147: the confirm says how many moves.
  await expect(
    choice.getByText(plural(t.question, { count }), { exact: true }),
  ).toBeVisible();
  await choice.getByRole('button', { name: t.confirm, exact: true }).click();
  await expect(
    choice.getByText(plural(t.marked, { count }), { exact: true }),
  ).toBeVisible();
  // Nothing new is left in it: it says Known (n moves).
  await expect(choice.getByText(anyCount(t.known))).toBeVisible();
  return count;
}

/** Chooses every chapter in turn and marks it known; the counts confirmed. */
export async function markChaptersKnown(
  page: Page,
  messages: Messages,
): Promise<number[]> {
  const list = await openChapters(page);
  const chapters = await list.getByRole('listitem').count();
  const counts: number[] = [];
  for (let i = 0; i < chapters; i += 1) {
    await chooseChapterAt(page, i);
    const count = await markKnown(page, messages);
    if (count !== null) counts.push(count);
  }
  return counts;
}
