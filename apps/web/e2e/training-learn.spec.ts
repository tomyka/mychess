// S6 journeys (plan Task D3), Rokas and his Italian (docs/personas/
// u1400.md): U1-M1-2 the learn pass, U1-M1-3 the next day's review,
// U1-M1-4 a transposing line not taught again. Adapted to what was built:
// the Italian is his own import (an assigned one trains the same way, S5),
// and "the next day" is his Reviews made due in the database
// (support/training-db.ts), as the suite has no clock to move. #330
// (plan Task 19): learning one line from the repertoire page (R-206),
// moves learned but not yet sent not taught again (decision 2), and the
// daily limit notice (decision 11).
import { expect, type Page } from '@playwright/test';
import { CATALOGUES, test } from './support/journey';
import { allDue, loggedResults, storedReviews } from './support/training-db';
import {
  answer,
  doneHeading,
  drillToDone,
  expectCounter,
  ownKeys,
  setTrainingLimits,
  type Asked,
  type Drill,
} from './support/training';
import { chip, disclosure, plural } from './support/repertoires';
import {
  arrow,
  dueLine,
  ITALIAN,
  italian,
  learnPianissimo,
  rokasWithItalian,
  startTodayReview,
  stat,
  today,
  trainLink,
} from './support/training-cast';

const { en } = CATALOGUES;

/** The Pianissimo's eight White moves (1.e4 to 8.Bb3). */
const PIANISSIMO = ['e4', 'Nf3', 'Bc4', 'c3', 'd3', 'O-O', 'Re1', 'Bb3'];

const HOUR = 3_600_000;

/** Where the browser posts training results (src/lib/routes.ts). */
const RESULTS = '/api/training/results';

test(
  'U1-M1-2: Rokas learns the Giuoco Pianissimo: arrows, then blind, then learned',
  { tag: '@mobile' },
  async ({ page, request, isMobile }) => {
    test.setTimeout(180_000);
    const email = await rokasWithItalian(page, request);
    const drill: Drill = { page, messages: en, books: [italian], isMobile };
    await trainLink(page, en, 'learn', 8).click();
    await expectCounter(page, 0, 8);
    // The arrows round: each move shown with an arrow, played tap-tap.
    for (const san of PIANISSIMO) {
      await expect(arrow(page)).toHaveCount(1);
      const asked = await answer(drill, 'board');
      expect([asked.move.san, asked.prompt]).toEqual([
        san,
        en.training.learn.arrows,
      ]);
    }
    await expectCounter(page, 0, 8);
    // The blind round: no arrow; a wrong 4th move goes back to its arrow.
    for (const san of PIANISSIMO.slice(0, 3)) {
      const asked = await answer(drill);
      expect([asked.move.san, asked.prompt]).toEqual([
        san,
        en.training.learn.blind,
      ]);
    }
    await expect(arrow(page)).toHaveCount(0);
    await answer(drill, 'wrong');
    await expect(page.getByText(en.training.learn.wrong)).toBeVisible();
    await expect(arrow(page)).toHaveCount(1);
    const rest = await drillToDone(drill);
    expect(rest.map((a) => a.move.san)).toEqual(
      expect.arrayContaining(PIANISSIMO.slice(3)),
    );
    await expect(stat(page, en.training.done.learned)).toHaveText('8');
    // Learned: eight Reviews, each first due a day later.
    await expect(async () => {
      const reviews = await storedReviews(email);
      expect(reviews).toHaveLength(8);
      for (const review of reviews) {
        expect(review.learned_at).not.toBeNull();
        const wait = review.due.getTime() - Date.now();
        expect(wait).toBeGreaterThan(23 * HOUR);
        expect(wait).toBeLessThan(25 * HOUR);
      }
    }).toPass({ timeout: 10_000 });
  },
);

test(
  'U1-M1-3: the next day Rokas sees the due count and time, reviews, lapses once, and is done',
  { tag: '@mobile' },
  async ({ page, request, isMobile }) => {
    test.setTimeout(180_000);
    const email = await rokasWithItalian(page, request);
    const drill: Drill = { page, messages: en, books: [italian], isMobile };
    await learnPianissimo(drill);
    await allDue(email);
    await page.goto('/');
    // Shown before starting: eight due, about 2 minutes.
    await expect(today(page, en)).toContainText(dueLine('en', 8));
    await startTodayReview(page, en);
    await expectCounter(page, 0, 8);
    await answer(drill);
    await expectCounter(page, 1, 8);
    // A wrong answer: the right move shows as an arrow and must be played.
    const lapsed = await answer(drill, 'wrong');
    await expect(page.getByText(en.training.review.lapse)).toBeVisible();
    await expect(arrow(page)).toHaveCount(1);
    const replay = await answer(drill);
    expect(replay.key).toBe(lapsed.key);
    const rest = await drillToDone(drill);
    test.info().annotations.push({
      type: 'U1-M1-3',
      description: `after the lapse, asked: ${rest.map((a) => a.move.san).join(' ')}`,
    });
    await expect(doneHeading(page, en)).toBeVisible();
    await expect(stat(page, en.training.done.lapses)).toHaveText('1');
    // R-78 (#319): the lapsed move came back in the session until it stuck,
    // so the day is done and nothing is left to continue.
    expect(rest.filter((a) => a.key === lapsed.key).length).toBeGreaterThan(0);
    await expect(page.getByText(en.training.done.dayDone)).toBeVisible();
    await expect(
      page.getByRole('button', { name: en.training.done.continue }),
    ).toHaveCount(0);
    // R-59: the lapse is recorded once; every answer reached the server.
    await expect(async () => {
      const results = await loggedResults(email);
      const reviews = results.filter((r) => r.kind !== 'learned');
      expect(reviews.filter((r) => r.kind === 'lapse')).toHaveLength(1);
      expect(reviews.every((r) => r.applied)).toBe(true);
      // The first answer, the lapse (its replay records nothing), the rest.
      expect(reviews).toHaveLength(2 + rest.length);
    }).toPass({ timeout: 10_000 });
    // R-78: the lapsed move went through its relearning steps in the
    // session, so no Review comes due again within the hour.
    const stored = await storedReviews(email);
    for (const review of stored)
      expect([
        review.move_key,
        review.due.getTime() - Date.now() > HOUR,
      ]).toEqual([review.move_key, true]);
  },
);

test('U1-M1-4: the Two Knights after the Pianissimo teaches only its own new moves', async ({
  page,
  request,
  isMobile,
}) => {
  test.setTimeout(180_000);
  const email = await rokasWithItalian(page, request);
  const drill: Drill = { page, messages: en, books: [italian], isMobile };
  await learnPianissimo(drill);
  await setTrainingLimits(page, en, { newPerDay: 10 });
  await page.goto('/repertuarai');
  await page.getByRole('link', { name: new RegExp(`^${ITALIAN}`) }).click();
  // Two left today: the Two Knights' 4.d3 and 5.c3. From 5...d6 on it is
  // the Pianissimo's position, already learned, so not taught again.
  await trainLink(page, en, 'learn', 2).click();
  await expectCounter(page, 0, 2);
  const asked = await drillToDone(drill);
  test.info().annotations.push({
    type: 'U1-M1-4',
    description: asked.map((a) => `${a.move.san} (${a.prompt})`).join(', '),
  });
  const taught = asked
    .filter((a) => a.prompt !== en.training.learn.known)
    .map((a) => a.move.san);
  expect(new Set(taught)).toEqual(new Set(['d3', 'c3']));
  const pianissimo = new Set(ownKeys(italian).slice(0, 8));
  const shared = asked.filter((a) => pianissimo.has(`${a.key}|${a.move.san}`));
  expect(shared.length).toBeGreaterThan(0);
  for (const a of shared) expect(a.prompt).toBe(en.training.learn.known);
  await expect(stat(page, en.training.done.learned)).toHaveText('2');
  await expect(async () => {
    expect(await storedReviews(email)).toHaveLength(10);
  }).toPass({ timeout: 10_000 });
});

/** From Mano repertuarai, the Italian's page; its id. */
async function openItalian(page: Page): Promise<string> {
  await page.goto('/repertuarai');
  await page.getByRole('link', { name: new RegExp(`^${ITALIAN}`) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ITALIAN);
  const id = /\/repertuarai\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (id === undefined) throw new Error(`no repertoire id in ${page.url()}`);
  return id;
}

/** The full key of what was asked, as ownKeys and the Reviews write it. */
const keyOf = (a: Asked): string => `${a.key}|${a.move.san}`;

/** What a drill taught as new: every ask but "you know this move". */
const taughtSans = (asked: readonly Asked[]): Set<string> =>
  new Set(
    asked
      .filter((a) => a.prompt !== en.training.learn.known)
      .map((a) => a.move.san),
  );

test(
  'U1-M1-2 (R-206): Rokas learns one line from the repertoire page: only its new moves',
  { tag: '@mobile' },
  async ({ page, request, isMobile }) => {
    test.setTimeout(180_000);
    const email = await rokasWithItalian(page, request);
    const drill: Drill = { page, messages: en, books: [italian], isMobile };
    // A day's allowance well past the line, so the line is what limits it.
    await setTrainingLimits(page, en, { newPerDay: 20 });
    await openItalian(page);
    await expect(trainLink(page, en, 'learn', 20)).toBeVisible();
    // The Pianissimo's last move makes it the current line.
    await chip(page, '8... Ba7').click();
    await page
      .getByRole('link', {
        name: plural(en.training.repertoire.learnLine, 'en', { count: 8 }),
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(
      /\/treniruote\?mode=learn&r=.+&chapter=.+&line=\d+$/,
    );
    await expectCounter(page, 0, 8);
    const asked = await drillToDone(drill);
    expect(taughtSans(asked)).toEqual(new Set(PIANISSIMO));
    await expect(stat(page, en.training.done.learned)).toHaveText('8');
    await expect(async () => {
      const reviews = await storedReviews(email);
      expect(new Set(reviews.map((r) => r.move_key))).toEqual(
        new Set(ownKeys(italian).slice(0, 8)),
      );
    }).toPass({ timeout: 10_000 });
  },
);

/** On the Italian's page: learns the Two Knights chapter from its row; what was asked. */
async function learnTwoKnights(drill: Drill): Promise<Asked[]> {
  const { page } = drill;
  const trigger = disclosure(page);
  if ((await trigger.getAttribute('aria-expanded')) === 'false')
    await trigger.click();
  // Its own new moves are 4.d3 and 5.c3; the only chapter with two.
  const prefix = plural(en.training.repertoire.learnIn, 'en', {
    count: 2,
    subject: '',
  });
  await page.getByRole('link', { name: new RegExp(`^${prefix}`) }).click();
  await expect(page).toHaveURL(/&chapter=/);
  await expectCounter(page, 0, 2);
  const asked = await drillToDone(drill);
  expect(taughtSans(asked)).toEqual(new Set(['d3', 'c3']));
  return asked;
}

test('decision 2: moves learned but not yet sent are not taught again on a fresh training page', async ({
  page,
  request,
  isMobile,
}) => {
  test.setTimeout(240_000);
  const email = await rokasWithItalian(page, request);
  const drill: Drill = { page, messages: en, books: [italian], isMobile };
  await learnPianissimo(drill);
  await setTrainingLimits(page, en, { newPerDay: 20 });
  const id = await openItalian(page);
  // From here on no result reaches the server: the page's snapshot never
  // has what the browser still holds.
  await page.route(`**${RESULTS}`, (route) => route.abort());
  const justLearned = new Set(
    (await learnTwoKnights(drill))
      .filter((a) => a.prompt !== en.training.learn.known)
      .map(keyOf),
  );
  expect(await storedReviews(email)).toHaveLength(8);
  await page.goto(`/treniruote?mode=learn&r=${id}`);
  const asked = await drillToDone(drill);
  test.info().annotations.push({
    type: 'decision 2',
    description: asked.map((a) => `${a.move.san} (${a.prompt})`).join(', '),
  });
  // Not taught again: first asked as known, never shown with its arrow.
  // (The blind round replays the whole line, known moves too.)
  // 4.d3 is on the 4...Be7 chapter's way, so it comes up at least once.
  const again = [...justLearned].filter((k) =>
    asked.some((a) => keyOf(a) === k),
  );
  expect(again.length).toBeGreaterThan(0);
  for (const key of again) {
    const asks = asked.filter((a) => keyOf(a) === key);
    expect([key, asks[0]?.prompt]).toEqual([key, en.training.learn.known]);
    expect(asks.map((a) => a.prompt)).not.toContain(en.training.learn.arrows);
  }
  const learnedNow = Number(
    await stat(page, en.training.done.learned).textContent(),
  );
  expect(await storedReviews(email)).toHaveLength(8);
  // Unblocked, the held results land, sent from a training page (only it
  // syncs): the Two Knights' and the new page's.
  await page.unroute(`**${RESULTS}`);
  await page.goto('/treniruote?mode=review');
  await expect(async () => {
    const keys = new Set((await storedReviews(email)).map((r) => r.move_key));
    expect(keys.size).toBe(8 + justLearned.size + learnedNow);
    for (const key of justLearned) expect(keys).toContain(key);
  }).toPass({ timeout: 20_000 });
});

test('decision 11: with the day’s new moves used, the repertoire page says so and links to the setting', async ({
  page,
  request,
  isMobile,
}) => {
  test.setTimeout(180_000);
  await rokasWithItalian(page, request);
  const drill: Drill = { page, messages: en, books: [italian], isMobile };
  await setTrainingLimits(page, en, { newPerDay: 1 });
  await openItalian(page);
  await trainLink(page, en, 'learn', 1).click();
  await drillToDone(drill);
  await expect(stat(page, en.training.done.learned)).toHaveText('1');
  await openItalian(page);
  const t = en.training.repertoire;
  await expect(
    page.getByText(plural(t.limitReached, 'en', { count: 1 })),
  ).toBeVisible();
  await expect(trainLink(page, en, 'learn', 0)).toHaveCount(0);
  await page.getByRole('link', { name: t.limitSettings, exact: true }).click();
  await expect(page).toHaveURL(/\/nustatymai#/);
  await expect(
    page.getByRole('region', { name: en.training.settings.title }),
  ).toBeVisible();
});
