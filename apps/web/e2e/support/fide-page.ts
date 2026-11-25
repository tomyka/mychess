// Opponent's games (/fide) as a person reads it, for the journeys over the
// month dumps (fide-search.spec.ts) and the community broadcasts
// (community-broadcasts.spec.ts).
import { expect, type Locator, type Page } from '@playwright/test';
import { FIXTURE_MONTHS } from './broadcast-fixture';
import { en, format } from './journey';

/** Waiting for the runner: one poll every 5 s, two tiny months. */
export const MONTHS_READY_MS = 60_000;

/** A game's date as the page writes it in English (game-list.tsx). */
const DATE = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** The credit's links (#348, R-198): the games' source and their licence. */
const CREDIT = [
  ['Lichess broadcasts', 'https://lichess.org/broadcast'],
  ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
] as const;

/** How a found game reads on the page, its result from the searched side. */
export interface ShownGame {
  readonly date: string;
  readonly event: string;
  readonly opponent: string;
  readonly opponentFideId: number | undefined;
  readonly colour: 'white' | 'black';
  readonly outcome: 'win' | 'draw' | 'loss';
  readonly eco: string;
  /** The Lichess opening name, "Family: Variation" or the family alone. */
  readonly opening: string;
  readonly url: string;
}

/** The family a Lichess opening name is grouped under (R-189). */
export function familyOf(opening: string): string {
  const [family = opening] = opening.split(':');
  return family.trim();
}

/**
 * How a game's opening reads inside its family's group (#347 F2): the ECO
 * and the variation, or the whole name when it is the family alone.
 */
function shownOpening(game: ShownGame): string {
  const variation = game.opening.slice(familyOf(game.opening).length);
  const rest = variation.replace(/^\s*:\s*/, '');
  return `${game.eco} ${rest === '' ? game.opening : rest}`;
}

/** "{ready} of {total} months ready", for the fixture's months. */
export function monthsReady(ready: number): string {
  return format(en.fide.monthsReady, {
    ready: String(ready),
    total: String(FIXTURE_MONTHS.length),
  });
}

/** Types `typed` into the FIDE ID field and searches. */
export async function search(page: Page, typed: string): Promise<void> {
  await page.getByLabel(en.fide.idLabel).fill(typed);
  await page.getByRole('button', { name: en.fide.submit }).click();
}

/** The result of a search for `id`. */
export function resultOf(page: Page, id: number): Locator {
  return page.getByRole('region', {
    name: format(en.fide.resultsTitle, { id: String(id) }),
  });
}

function opponentLine(game: ShownGame): string {
  return game.opponentFideId === undefined
    ? format(en.fide.opponent, { name: game.opponent })
    : format(en.fide.opponentWithId, {
        name: game.opponent,
        id: String(game.opponentFideId),
      });
}

/** That `item` shows `game`, with its link to Lichess in a new tab. */
export async function expectGame(
  item: Locator,
  game: ShownGame,
): Promise<void> {
  const date = DATE.format(new Date(`${game.date}T00:00:00Z`));
  await expect(item).toContainText(`${date} · ${game.event}`);
  await expect(item).toContainText(opponentLine(game));
  await expect(item).toContainText(en.fide[game.outcome]);
  await expect(item).toContainText(shownOpening(game));
  const link = item.getByRole('link', { name: en.fide.openOnLichess });
  await expect(link).toHaveAttribute('href', game.url);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
}

/** The list item of `result` that links to `url`. */
export function gameItem(result: Locator, url: string): Locator {
  return result
    .getByRole('listitem')
    .filter({ has: result.page().locator(`a[href="${url}"]`) });
}

/** That `result` carries the Lichess credit with its two links. */
export async function expectCredit(result: Locator): Promise<void> {
  for (const [name, href] of CREDIT) {
    const link = result.getByRole('link', { name });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
}
