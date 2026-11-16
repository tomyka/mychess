import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import {
  ORGANISER_PLAYER_FIDE_ID,
  ORGANISER_TOUR,
  PASTED_PLAYER_FIDE_ID,
  PASTED_TOUR,
  RUNNING_TOUR,
  apiFixtureFiles,
  organiserGames,
  pastedGames,
  roundLink,
  tourLink,
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
import {
  CATALOGUES,
  format,
  newOnboardedAccount,
  test,
} from './support/journey';

// Community broadcasts in Opponent's games (#349, R-196 to R-200): the app
// asks the Lichess broadcast API through its fixture fetch, which answers
// from the committed files of e2e/support/broadcast-api-fixture.ts, with a
// synthetic token (support/community-env.ts). What the component suite
// (test/feature/community-broadcasts.test.ts) checks of the services, this
// checks through the page and the running app: its env, the pacer and the
// runner of one server process, and the nightly route over HTTP.

const { en } = CATALOGUES;

/** The runner fetches a tournament a second or two after it is queued. */
const TOUR_FETCHED_MS = 30_000;

/** Pastes `link` into "Add a Lichess broadcast". */
async function paste(page: Page, link: string): Promise<void> {
  await page.getByLabel(en.fide.linkLabel).fill(link);
  await page.getByRole('button', { name: en.fide.addSubmit }).click();
}

/** The "Add a Lichess broadcast" section. */
function addSection(page: Page): Locator {
  return page.getByRole('region', { name: en.fide.addTitle });
}

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

test('a player pastes a Lichess broadcast round link, sees it added, and once it is fetched finds its games by FIDE ID with the Lichess credit', async ({
  page,
  request,
}) => {
  await newOnboardedAccount(page, request, 'Dovile');
  await page.goto('/fide');
  const section = addSection(page);
  const field = page.getByLabel(en.fide.linkLabel);

  // Refused links keep the field, marked, with the reason.
  for (const [link, refusal] of [
    [
      'https://example.com/broadcast/synthetic-club-rapid/SynPst01',
      en.fide.broadcastLinkInvalid,
    ],
    [
      'https://lichess.org/broadcast/no-such-broadcast/SynNone1',
      en.fide.tourNotFound,
    ],
    [roundLink(RUNNING_TOUR, 'SynRR001'), en.fide.tourNotFinished],
  ] as const) {
    await paste(page, link);
    await expect(section.getByText(refusal)).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveValue(link);
  }

  await paste(page, roundLink(PASTED_TOUR, 'SynPR002'));
  await expect(
    section.getByText(
      format(en.fide.broadcastAdded, { name: PASTED_TOUR.name }),
    ),
  ).toBeVisible();
  // The field empties once the link is added, its refusal mark gone.
  await expect(field).toHaveValue('');
  await expect(field).not.toHaveAttribute('aria-invalid', 'true');

  // The tournament's own link names the same one: added already.
  await paste(page, tourLink(PASTED_TOUR));
  await expect(
    section.getByText(
      format(en.fide.broadcastKnown, { name: PASTED_TOUR.name }),
    ),
  ).toBeVisible();

  // Only the pasted, finished tournament was queued, and the runner
  // fetched it.
  await expect
    .poll(fixtureTourStates, { timeout: TOUR_FETCHED_MS })
    .toEqual({ [PASTED_TOUR.id]: 'done' });

  const result = await searchReady(page, PASTED_PLAYER_FIDE_ID);
  const games = pastedGames();
  await expect(result.getByRole('listitem')).toHaveCount(games.length);
  for (const game of games) {
    const item = gameItem(result, game.url);
    await expect(item).toHaveCount(1);
    await expectGame(item, game);
  }
  await expectCredit(result);
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
