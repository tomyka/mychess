// S6 journeys (plan Task D3) over a due backlog: G-M1-4 (Gabija clears 85
// due over two sessions, stopping mid-session), D-M1-5 (Dovydas reviews
// from 150 due) and a dropped connection that loses no result (R-60). The
// backlog is seeded due in the database (support/training-db.ts), as
// the suite has no clock to move; the repertoire is a generated White file
// (fixtures/backlog.pgn), large enough for both backlogs.
import { expect } from '@playwright/test';
import { CATALOGUES, newOnboardedAccount, test } from './support/journey';
import { plural } from './support/repertoires';
import { loggedResults, seedDue } from './support/training-db';
import {
  answer,
  counter,
  doneHeading,
  drillToDone,
  expectCounter,
  ownKeys,
  setTrainingLimits,
  type Drill,
} from './support/training';
import {
  BACKLOG,
  BACKLOG_PGN,
  backlog,
  dueLine,
  startTodayReview,
  stat,
  today,
} from './support/training-cast';
import { importRepertoire } from './support/assignments';

const { lt } = CATALOGUES;

/** The End session link of a drill. */
const endSession = (drill: Drill) =>
  drill.page.getByRole('link', {
    name: drill.messages.training.drill.end,
    exact: true,
  });

test('G-M1-4: Gabija clears 85 due over two sessions, stopping mid-session', async ({
  page,
  request,
  isMobile,
}) => {
  test.setTimeout(300_000);
  const email = await newOnboardedAccount(page, request, 'Gabija Navickaitė');
  await setTrainingLimits(page, lt, { sessionSize: 60 });
  await importRepertoire(page, lt, {
    file: BACKLOG_PGN,
    side: 'white',
    name: BACKLOG,
  });
  // The last of the 85 keys is the most overdue: urgency, not line order.
  const due = ownKeys(backlog).slice(0, 85).reverse();
  await seedDue(email, due);
  const drill: Drill = { page, messages: lt, books: [backlog], isMobile };
  await page.goto('/');
  await expect(today(page, lt)).toContainText(dueLine('lt', 85));
  await startTodayReview(page, lt);
  await expectCounter(page, 0, 60);
  const first = await answer(drill);
  expect(`${first.key}|${first.move.san}`).toBe(due[0]);
  for (let i = 1; i < 30; i += 1) await answer(drill);
  await expectCounter(page, 30, 60);
  // Stop mid-session, straight after the last answer; then reload.
  await endSession(drill).click();
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await expect(today(page, lt)).toContainText(dueLine('lt', 55));
  await startTodayReview(page, lt);
  await expectCounter(page, 0, 55);
  expect(await drillToDone(drill)).toHaveLength(55);
  await page.goto('/');
  await expect(today(page, lt)).toContainText(lt.training.today.nothingDue);
  const results = await loggedResults(email);
  expect(results).toHaveLength(85);
  expect(new Set(results.map((r) => r.move_key))).toEqual(new Set(due));
});

test('D-M1-5: Dovydas reviews from a backlog of 150: sessions of 20, every answer advances', async ({
  page,
  request,
  isMobile,
}) => {
  test.setTimeout(240_000);
  const email = await newOnboardedAccount(page, request, 'Dovydas Jankauskas');
  await importRepertoire(page, lt, {
    file: BACKLOG_PGN,
    side: 'white',
    name: BACKLOG,
  });
  await seedDue(email, ownKeys(backlog).slice(0, 150));
  const drill: Drill = { page, messages: lt, books: [backlog], isMobile };
  await page.goto('/');
  await expect(today(page, lt)).toContainText(dueLine('lt', 150));
  await startTodayReview(page, lt);
  // The default session is 20 of the 150 (R-62).
  await expectCounter(page, 0, 20);
  const started = Date.now();
  // Only his own moves are asked (answer reads each as one).
  for (let i = 1; i <= 20; i += 1) {
    await answer(drill);
    if (i < 20) await expectCounter(page, i, 20);
  }
  await expect(doneHeading(page, lt)).toBeVisible();
  await expect(stat(page, lt.training.done.reviewed)).toHaveText('20');
  test.info().annotations.push({
    type: 'D-M1-5',
    description: `20 answers in ${String(Date.now() - started)} ms`,
  });
  // "Continue": the next 20 of the 130 left.
  await page
    .getByRole('button', { name: lt.training.done.continue, exact: true })
    .click();
  await expectCounter(page, 0, 20);
  // R-61: a hint marks the piece to move and counts as a lapse.
  await page
    .getByRole('button', { name: lt.training.review.hint, exact: true })
    .click();
  await expect(page.getByText(lt.training.review.hinted)).toBeVisible();
  await answer(drill);
  expect(await counter(page)).toEqual({ done: 1, total: 20 });
  await expect(async () => {
    const results = await loggedResults(email);
    expect(results).toHaveLength(21);
    expect(results.filter((r) => r.kind === 'hint')).toHaveLength(1);
  }).toPass({ timeout: 10_000 });
});

test('a dropped connection loses no result: 3 answers wait offline, then sync (R-60)', async ({
  page,
  context,
  request,
  isMobile,
}) => {
  test.setTimeout(180_000);
  const email = await newOnboardedAccount(page, request, 'Dovydas Jankauskas');
  await importRepertoire(page, lt, {
    file: BACKLOG_PGN,
    side: 'white',
    name: BACKLOG,
  });
  await seedDue(email, ownKeys(backlog).slice(0, 5));
  const drill: Drill = { page, messages: lt, books: [backlog], isMobile };
  await page.goto('/treniruote?mode=review');
  await expectCounter(page, 0, 5);
  await answer(drill);
  await expect(async () => {
    expect(await loggedResults(email)).toHaveLength(1);
  }).toPass({ timeout: 10_000 });
  await context.setOffline(true);
  for (let i = 0; i < 3; i += 1) await answer(drill);
  await expectCounter(page, 4, 5);
  const banner = page.getByText(
    plural(lt.training.sync.unsynced, 'lt', { count: 3 }),
    { exact: true },
  );
  const retry = page.getByRole('button', { name: lt.training.sync.retry });
  await expect(banner).toBeVisible();
  await expect(retry).toBeVisible();
  expect(await loggedResults(email)).toHaveLength(1);
  await context.setOffline(false);
  await expect(banner).toHaveCount(0, { timeout: 15_000 });
  await expect(retry).toHaveCount(0);
  const results = await loggedResults(email);
  expect(results).toHaveLength(4);
  expect(results.every((r) => r.applied && r.kind === 'pass')).toBe(true);
  // After a reload only the one not answered is due.
  await page.reload();
  await expectCounter(page, 0, 1);
});
