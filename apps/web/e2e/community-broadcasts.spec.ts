import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import {
  ORGANISER_PLAYER_FIDE_ID,
  ORGANISER_TOUR,
  apiFixtureFiles,
  organiserGames,
} from './support/broadcast-api-fixture';
import { fixtureTourStates, removeFixtureTours } from './support/broadcast-db';
import {
  BROADCAST_FIXTURE_DIR,
  dumpGameUrl,
} from './support/broadcast-fixture';
import { E2E_CRON_SECRET } from './support/community-env';
import {
  MONTHS_READY_MS,
  expectCredit,
  expectGame,
  gameItem,
  monthsReady,
  resultOf,
  search,
} from './support/fide-page';
import { newOnboardedAccount, test } from './support/journey';

// Community broadcasts in Opponent's games (#349, R-196, R-198 to R-201):
// tournaments reach the index only through the nightly organiser listing;
// pasting a link was removed (R-201, #360). The app
// asks the Lichess broadcast API through its fixture fetch, which answers
// from the committed files of e2e/support/broadcast-api-fixture.ts, with a
// synthetic token (support/community-env.ts). What the component suite
// (test/feature/community-broadcasts.test.ts) checks of the services, this
// checks through the page and the running app: its env, the pacer and the
// runner of one server process, and the nightly route over HTTP.

/** The runner fetches a tournament a second or two after it is queued. */
const TOUR_FETCHED_MS = 30_000;

/** Searches `id` and waits for both fixture months to be ready. */
async function searchReady(page: Page, id: number): Promise<Locator> {
  await search(page, String(id));
  const result = resultOf(page, id);
  await expect(result.getByText(monthsReady(2))).toBeVisible({
    timeout: MONTHS_READY_MS,
  });
  return result;
}

test.beforeEach(async () => {
  await removeFixtureTours();
});

test('the committed Lichess broadcast API fixtures are the ones broadcast-api-fixture.ts makes', () => {
  for (const [name, bytes] of apiFixtureFiles()) {
    const committed = readFileSync(join(BROADCAST_FIXTURE_DIR, name));
    if (extname(name) === '.json') {
      // Prettier lays the committed JSON out; its value is what counts.
      expect(JSON.parse(committed.toString('utf8')), name).toEqual(
        JSON.parse(Buffer.from(bytes).toString('utf8')),
      );
    } else {
      expect(committed.equals(bytes), name).toBe(true);
    }
  }
});

test("an approved organiser's community tournament, found by the nightly route, shows in a search, and its copy of an official game shows once", async ({
  page,
  request,
}) => {
  await newOnboardedAccount(page, request, 'Arunas');

  const night = await request.get('/api/cron/index-broadcasts', {
    headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
  });
  expect(night.status()).toBe(202);
  expect(await night.json()).toMatchObject({ community: 'started' });

  // Of paulauskas's three tournaments only the finished community one is
  // queued: the official one is in the dumps, the other is still running.
  await expect
    .poll(fixtureTourStates, { timeout: TOUR_FETCHED_MS })
    .toEqual({ [ORGANISER_TOUR.id]: 'done' });

  await page.goto('/fide');
  const result = await searchReady(page, ORGANISER_PLAYER_FIDE_ID);

  const [community, copy] = organiserGames();
  if (community === undefined || copy === undefined) {
    throw new Error('the organiser fixture has two games');
  }
  // The community game, and the official dump game in place of the
  // tournament's copy of it (same day, players and result).
  await expect(result.getByRole('listitem')).toHaveCount(2);
  await expectGame(gameItem(result, community.url), community);
  await expect(gameItem(result, copy.url)).toHaveCount(0);
  const official = gameItem(result, dumpGameUrl('Wint0003'));
  await expectGame(official, {
    ...copy,
    event: 'Synthetic Winter Open',
    url: dumpGameUrl('Wint0003'),
  });
  await expectCredit(result);
});
