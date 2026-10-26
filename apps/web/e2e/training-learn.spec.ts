// S6 journeys (plan Task D3), Rokas and his Italian (docs/personas/
// u1400.md): U1-M1-2 the learn pass, U1-M1-3 the next day's review,
// U1-M1-4 a transposing line not taught again. Adapted to what was built:
// the Italian is his own import (an assigned one trains the same way, S5),
// and "the next day" is his Reviews made due in the database
// (support/training-db.ts), as the suite has no clock to move.
import { expect } from '@playwright/test';
import { CATALOGUES, test } from './support/journey';
import { allDue, loggedResults, storedReviews } from './support/training-db';
import {
  answer,
  doneHeading,
  drillToDone,
  expectCounter,
  ownKeys,
  setTrainingLimits,
  type Drill,
} from './support/training';
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

const { lt } = CATALOGUES;

/** The Pianissimo's eight White moves (1.e4 to 8.Bb3). */
const PIANISSIMO = ['e4', 'Nf3', 'Bc4', 'c3', 'd3', 'O-O', 'Re1', 'Bb3'];

const HOUR = 3_600_000;

test('U1-M1-2: Rokas learns the Giuoco Pianissimo: arrows, then blind, then learned', async ({
  page,
  request,
  isMobile,
}) => {
  test.setTimeout(180_000);
  const email = await rokasWithItalian(page, request);
  const drill: Drill = { page, messages: lt, books: [italian], isMobile };
  await trainLink(page, lt, 'learn', 8).click();
  await expectCounter(page, 0, 8);
  // The arrows round: each move shown with an arrow, played tap-tap.
  for (const san of PIANISSIMO) {
    await expect(arrow(page)).toHaveCount(1);
    const asked = await answer(drill, 'board');
    expect([asked.move.san, asked.prompt]).toEqual([
      san,
      lt.training.learn.arrows,
    ]);
  }
  await expectCounter(page, 0, 8);
  // The blind round: no arrow; a wrong 4th move goes back to its arrow.
  for (const san of PIANISSIMO.slice(0, 3)) {
    const asked = await answer(drill);
    expect([asked.move.san, asked.prompt]).toEqual([
      san,
      lt.training.learn.blind,
    ]);
  }
  await expect(arrow(page)).toHaveCount(0);
  await answer(drill, 'wrong');
  await expect(page.getByText(lt.training.learn.wrong)).toBeVisible();
  await expect(arrow(page)).toHaveCount(1);
  const rest = await drillToDone(drill);
  expect(rest.map((a) => a.move.san)).toEqual(
    expect.arrayContaining(PIANISSIMO.slice(3)),
  );
  await expect(stat(page, lt.training.done.learned)).toHaveText('8');
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
});

test('U1-M1-3: the next day Rokas sees the due count and time, reviews, lapses once, and is done', async ({
  page,
  request,
  isMobile,
}) => {
  test.setTimeout(180_000);
  const email = await rokasWithItalian(page, request);
  const drill: Drill = { page, messages: lt, books: [italian], isMobile };
  await learnPianissimo(drill);
  await allDue(email);
  await page.goto('/');
  // Shown before starting: eight due, about 2 minutes.
  await expect(today(page, lt)).toContainText(dueLine('lt', 8));
  await startTodayReview(page, lt);
  await expectCounter(page, 0, 8);
  await answer(drill);
  await expectCounter(page, 1, 8);
  // A wrong answer: the right move shows as an arrow and must be played.
  const lapsed = await answer(drill, 'wrong');
  await expect(page.getByText(lt.training.review.lapse)).toBeVisible();
  await expect(arrow(page)).toHaveCount(1);
  const replay = await answer(drill);
  expect(replay.key).toBe(lapsed.key);
  const rest = await drillToDone(drill);
  test.info().annotations.push({
    type: 'U1-M1-3',
    description: `after the lapse, asked: ${rest.map((a) => a.move.san).join(' ')}`,
  });
  await expect(doneHeading(page, lt)).toBeVisible();
  await expect(stat(page, lt.training.done.lapses)).toHaveText('1');
  // R-59: the lapse is recorded once; every answer reached the server.
  await expect(async () => {
    const results = await loggedResults(email);
    const reviews = results.filter((r) => r.kind !== 'learned');
    expect(reviews.filter((r) => r.kind === 'lapse')).toHaveLength(1);
    expect(reviews.every((r) => r.applied)).toBe(true);
    // The first answer, the lapse (its replay records nothing), the rest.
    expect(reviews).toHaveLength(2 + rest.length);
  }).toPass({ timeout: 10_000 });
  // R-78: the lapsed move keeps its relearning step: due again within the
  // hour (the done summary's "continue" offers it then), the rest later.
  const stored = await storedReviews(email);
  const lapsedKey = `${lapsed.key}|${lapsed.move.san}`;
  for (const review of stored) {
    const soon = review.due.getTime() - Date.now() < HOUR;
    expect([review.move_key, soon]).toEqual([
      review.move_key,
      review.move_key === lapsedKey,
    ]);
  }
});

test('U1-M1-4: the Two Knights after the Pianissimo teaches only its own new moves', async ({
  page,
  request,
  isMobile,
}) => {
  test.setTimeout(180_000);
  const email = await rokasWithItalian(page, request);
  const drill: Drill = { page, messages: lt, books: [italian], isMobile };
  await learnPianissimo(drill);
  await setTrainingLimits(page, lt, { newPerDay: 10 });
  await page.goto('/repertuarai');
  await page.getByRole('link', { name: new RegExp(`^${ITALIAN}`) }).click();
  // Two left today: the Two Knights' 4.d3 and 5.c3. From 5...d6 on it is
  // the Pianissimo's position, already learned, so not taught again.
  await trainLink(page, lt, 'learn', 2).click();
  await expectCounter(page, 0, 2);
  const asked = await drillToDone(drill);
  test.info().annotations.push({
    type: 'U1-M1-4',
    description: asked.map((a) => `${a.move.san} (${a.prompt})`).join(', '),
  });
  const taught = asked
    .filter((a) => a.prompt !== lt.training.learn.known)
    .map((a) => a.move.san);
  expect(new Set(taught)).toEqual(new Set(['d3', 'c3']));
  const pianissimo = new Set(ownKeys(italian).slice(0, 8));
  const shared = asked.filter((a) => pianissimo.has(`${a.key}|${a.move.san}`));
  expect(shared.length).toBeGreaterThan(0);
  for (const a of shared) expect(a.prompt).toBe(lt.training.learn.known);
  await expect(stat(page, lt.training.done.learned)).toHaveText('2');
  await expect(async () => {
    expect(await storedReviews(email)).toHaveLength(10);
  }).toPass({ timeout: 10_000 });
});
