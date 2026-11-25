import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { resetFixtureMonths } from './support/broadcast-db';
import {
  BROADCAST_FIXTURE_DIR,
  FIXTURE_MONTHS,
  SEARCHED_FIDE_ID,
  expectedGames,
  fixtureFiles,
} from './support/broadcast-fixture';
import {
  MONTHS_READY_MS,
  expectCredit,
  expectGame,
  familyOf,
  monthsReady,
  resultOf,
  search,
} from './support/fide-page';
import { en, newOnboardedAccount, test } from './support/journey';
import { openTab } from './support/nav';

// Opponent's games (#316, R-171, R-183 to R-187): the app reads the
// committed fixture dumps (e2e/support/broadcast-fixture.ts), never
// database.lichess.org. Lichess's FIDE player endpoint answers 404 there,
// so the result is headed by the ID alone.

const ID = String(SEARCHED_FIDE_ID);

/**
 * The searched player's fixture games as the page groups them (R-189,
 * R-190): as White, then as Black; one game per family, so the families
 * are ordered by name, and every group starts open (the largest two are).
 */
const GROUPED = [
  {
    colour: 'white',
    title: en.fide.asWhite,
    families: ["King's Indian Defense", 'Russian Game'],
  },
  {
    colour: 'black',
    title: en.fide.asBlack,
    families: ['Caro-Kann Defense', "Queen's Gambit Declined"],
  },
] as const;

test('the committed fixture dumps are the ones broadcast-fixture.ts makes', () => {
  for (const [name, bytes] of fixtureFiles()) {
    const committed = readFileSync(join(BROADCAST_FIXTURE_DIR, name));
    expect(committed.equals(bytes), name).toBe(true);
  }
});

test("a player opens Opponent's games from the Opponents tab, searches a FIDE ID and sees its months become ready, then the games by colour and opening family", async ({
  page,
  request,
}) => {
  await newOnboardedAccount(page, request, 'Gintare');
  await resetFixtureMonths();

  await openTab(page, en, 'opponents');
  await expect(page).toHaveURL(/\/fide$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    en.fide.title,
  );
  // The page's own document, served with no referrer at all (security
  // requirements, task 4), not the site-wide same-origin.
  const document = await page.reload();
  expect(document?.headers()['referrer-policy']).toBe('no-referrer');

  await search(page, ID);

  const result = resultOf(page, SEARCHED_FIDE_ID);
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
  for (const { colour, title, families } of GROUPED) {
    const section = result.getByRole('region', { name: title });
    const groups = section.locator('details');
    await expect(groups).toHaveCount(families.length);
    for (const [n, family] of families.entries()) {
      const group = groups.nth(n);
      await expect(group).toHaveAttribute('open', '');
      await expect(group.locator('summary')).toContainText(family);
      const [game] = games.filter(
        (found) =>
          found.colour === colour && familyOf(found.opening) === family,
      );
      if (game === undefined) throw new Error(`no fixture game in ${family}`);
      const items = group.getByRole('listitem');
      await expect(items).toHaveCount(1);
      await expectGame(items.first(), game);
    }
  }

  await expectCredit(result);
});

test('a FIDE ID that is not one is refused on the page', async ({
  page,
  request,
}) => {
  await newOnboardedAccount(page, request, 'Mantas');
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
    // No search started: no result, no months, no region at all (the
    // "Add a Lichess broadcast" section was removed, R-201).
    await expect(page.getByRole('region')).toHaveCount(0);
  }
});
