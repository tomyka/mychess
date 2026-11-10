import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { storeLocale } from './support/account-db';
import { resetFixtureMonths } from './support/broadcast-db';
import {
  BROADCAST_FIXTURE_DIR,
  FIXTURE_MONTHS,
  SEARCHED_FIDE_ID,
  expectedGames,
  fixtureFiles,
  type ExpectedGame,
} from './support/broadcast-fixture';
import {
  CATALOGUES,
  format,
  newOnboardedAccount,
  test,
} from './support/journey';

// Opponent's games (#316, R-171, R-183 to R-187): the app reads the
// committed fixture dumps (e2e/support/broadcast-fixture.ts), never
// database.lichess.org. Lichess's FIDE player endpoint answers 404 there,
// so the result is headed by the ID alone.

const { en } = CATALOGUES;
const ID = String(SEARCHED_FIDE_ID);
const TOTAL = String(FIXTURE_MONTHS.length);

/** A game's date as the page writes it in English (game-list.tsx). */
const DATE = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Waiting for the runner: one poll every 5 s, two tiny months. */
const MONTHS_READY_MS = 60_000;

/**
 * The searched player's fixture games as the page groups them (R-189,
 * R-190): as White, then as Black; one game per family, so the families
 * are ordered by name, and every group starts open (the largest two are).
 */
const GROUPED = [
  {
    title: en.fide.asWhite,
    families: ["King's Indian Defense", 'Russian Game'],
  },
  {
    title: en.fide.asBlack,
    families: ['Caro-Kann Defense', "Queen's Gambit Declined"],
  },
] as const;

/** The credit's links (#348): the games' source and their licence. */
const CREDIT = [
  ['Lichess broadcasts', 'https://lichess.org/broadcast'],
  ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
] as const;

function monthsReady(ready: number): string {
  return format(en.fide.monthsReady, { ready: String(ready), total: TOTAL });
}

async function search(page: Page, typed: string): Promise<void> {
  await page.getByLabel(en.fide.idLabel).fill(typed);
  await page.getByRole('button', { name: en.fide.submit }).click();
}

function opponentLine(game: ExpectedGame): string {
  return game.opponentFideId === undefined
    ? format(en.fide.opponent, { name: game.opponent })
    : format(en.fide.opponentWithId, {
        name: game.opponent,
        id: String(game.opponentFideId),
      });
}

async function expectGame(item: Locator, game: ExpectedGame): Promise<void> {
  const date = DATE.format(new Date(`${game.date}T00:00:00Z`));
  await expect(item).toContainText(`${date} · ${game.event}`);
  await expect(item).toContainText(opponentLine(game));
  await expect(item).toContainText(en.fide[game.colour]);
  await expect(item).toContainText(en.fide[game.outcome]);
  await expect(item).toContainText(game.opening);
  const link = item.getByRole('link', { name: en.fide.openOnLichess });
  await expect(link).toHaveAttribute('href', game.url);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
}

test('the committed fixture dumps are the ones broadcast-fixture.ts makes', () => {
  for (const [name, bytes] of fixtureFiles()) {
    const committed = readFileSync(join(BROADCAST_FIXTURE_DIR, name));
    expect(committed.equals(bytes), name).toBe(true);
  }
});

test("a player opens Opponent's games from home, searches a FIDE ID and sees its months become ready, then the games by colour and opening family", async ({
  page,
  request,
}) => {
  await newOnboardedAccount(page, request, 'Gintare');
  await resetFixtureMonths();

  await page.getByRole('link', { name: en.app.fideSearch }).click();
  await expect(page).toHaveURL(/\/fide$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    en.fide.title,
  );
  // The page's own document, served with no referrer at all (security
  // requirements, task 4), not the site-wide same-origin.
  const document = await page.reload();
  expect(document?.headers()['referrer-policy']).toBe('no-referrer');

  await search(page, ID);

  const result = page.getByRole('region', {
    name: format(en.fide.resultsTitle, { id: ID }),
  });
  await expect(result.getByText(monthsReady(0))).toBeVisible();
  await expect(result.getByText(en.fide.monthsWaiting)).toBeVisible();
  await expect(
    result.getByText(monthsReady(FIXTURE_MONTHS.length)),
  ).toBeVisible({ timeout: MONTHS_READY_MS });
  await expect(result.getByText(en.fide.monthsWaiting)).toBeHidden();
  // The ID went in a POST body, never into the address.
  await expect(page).toHaveURL(/\/fide$/);

  const games = expectedGames();
  await expect(result.getByRole('listitem')).toHaveCount(games.length);
  for (const { title, families } of GROUPED) {
    const section = result.getByRole('region', { name: title });
    const groups = section.locator('details');
    await expect(groups).toHaveCount(families.length);
    for (const [n, family] of families.entries()) {
      const group = groups.nth(n);
      await expect(group).toHaveAttribute('open', '');
      await expect(group.locator('summary')).toContainText(family);
      const [game] = games.filter((found) =>
        found.opening.slice(found.opening.indexOf(' ') + 1).startsWith(family),
      );
      if (game === undefined) throw new Error(`no fixture game in ${family}`);
      const items = group.getByRole('listitem');
      await expect(items).toHaveCount(1);
      await expectGame(items.first(), game);
    }
  }

  for (const [name, href] of CREDIT) {
    const link = result.getByRole('link', { name });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
});

test('a FIDE ID that is not one is refused on the page, in English even for an account stored in Lithuanian (R-180)', async ({
  page,
  request,
}) => {
  const email = await newOnboardedAccount(page, request, 'Mantas');
  await storeLocale(email, 'lt');
  await page.goto('/fide');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    en.fide.title,
  );
  const field = page.getByLabel(en.fide.idLabel);

  for (const [typed, refusal] of [
    ['', en.fide.idBlank],
    ['01234', en.fide.idInvalid],
    ['12a45', en.fide.idInvalid],
    ['1234567890', en.fide.idTooLong],
  ] as const) {
    await search(page, typed);
    await expect(page.getByText(refusal)).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveValue(typed);
    // No search started: no result, no months.
    await expect(page.getByRole('region')).toHaveCount(0);
  }
});
