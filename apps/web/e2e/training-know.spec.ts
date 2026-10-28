// S6 journeys (plan Task D3), Dovydas's Catalans (docs/personas/
// 2000plus.md): D-M1-3 "I know this" on every chapter, and D-M1-7 the
// "two answers" notice between his main Catalan and his 8.a4 system
// (R-54), in English. The 7...a6 Reviews are seeded due in the database
// (support/training-db.ts), as the suite has no clock to move.
import { expect } from '@playwright/test';
import { importRepertoire } from './support/assignments';
import {
  CATALOGUES,
  chooseEnglish,
  format,
  newOnboardedAccount,
  test,
} from './support/journey';
import { seedDue, storedReviews } from './support/training-db';
import {
  answer,
  doneHeading,
  expectCounter,
  keyAfter,
  ownKeys,
  type Drill,
} from './support/training';
import {
  CATALAN,
  CATALAN_A4,
  CATALAN_A4_PGN,
  CATALAN_PGN,
  catalan,
  catalanA4,
  markChaptersKnown,
  startTodayReview,
  trainLink,
} from './support/training-cast';

const { lt, en } = CATALOGUES;

const HOUR = 3_600_000;

/** After 1.d4 Nf6 2.c4 e6 3.g3 d5 4.Bg2 Be7 5.Nf3 O-O 6.O-O dxc4 7.Qc2 a6. */
const AFTER_A6 = [
  ...['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7'],
  ...['Nf3', 'O-O', 'O-O', 'dxc4', 'Qc2', 'a6'],
];

/** Each Catalan's other repertoire, and the move it plays after 7...a6. */
const OTHER = new Map([
  [CATALAN, { name: CATALAN_A4, move: 'a4' }],
  [CATALAN_A4, { name: CATALAN, move: 'Qxc4' }],
]);

test('D-M1-3: Dovydas marks the Catalan chapters known: nothing to learn, reviews tomorrow', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const email = await newOnboardedAccount(page, request, 'Dovydas Jankauskas');
  const url = await importRepertoire(page, lt, {
    file: CATALAN_PGN,
    side: 'white',
    name: CATALAN,
  });
  await expect(trainLink(page, lt, 'learn', 10)).toBeVisible();
  const counts = await markChaptersKnown(page, lt, 'lt');
  // Every own move, each counted once, confirmed with its count (R-147).
  expect(counts).toHaveLength(4);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(ownKeys(catalan).length);
  await page.goto(url);
  await expect(trainLink(page, lt, 'review', 0)).toBeVisible();
  await trainLink(page, lt, 'learn', 0).click();
  await expect(
    page.getByRole('heading', { name: lt.training.empty.nothingLeft.title }),
  ).toBeVisible();
  await page.goto(url);
  await trainLink(page, lt, 'review', 0).click();
  await expect(
    page.getByRole('heading', { name: lt.training.empty.nothingDue.title }),
  ).toBeVisible();
  // "Next review: tomorrow HH:MM" (R-58: the first review is tomorrow), or
  // "in 24 h" once a minute passes after marking: review-time.ts words
  // anything under a day in hours (#308). The stored due times check R-58.
  const next = (when: string): string =>
    format(lt.training.empty.nothingDue.next, { when });
  const tomorrow = format(lt.training.when.tomorrow, { time: '' }).trim();
  const inADay = format(lt.training.when.hours, { count: '24' });
  await expect(
    page.getByText(next(tomorrow)).or(page.getByText(next(inADay))),
  ).toBeVisible();
  const reviews = await storedReviews(email);
  expect(reviews).toHaveLength(ownKeys(catalan).length);
  for (const review of reviews) {
    expect(review.skipped_at).not.toBeNull();
    const wait = review.due.getTime() - Date.now();
    expect(wait).toBeGreaterThan(23 * HOUR);
    expect(wait).toBeLessThan(25 * HOUR);
  }
});

test('D-M1-7 (en): reviewing both Catalans at 7...a6 shows the two-answers notice; each expects its own move', async ({
  page,
  request,
  isMobile,
}) => {
  test.setTimeout(180_000);
  const email = await newOnboardedAccount(page, request, 'Dovydas Jankauskas');
  await chooseEnglish(page);
  for (const [file, name] of [
    [CATALAN_PGN, CATALAN],
    [CATALAN_A4_PGN, CATALAN_A4],
  ] as const)
    await importRepertoire(page, en, { file, side: 'white', name });
  await seedDue(email, [
    keyAfter(catalan, AFTER_A6, 'Qxc4'),
    keyAfter(catalanA4, AFTER_A6, 'a4'),
  ]);
  const drill: Drill = {
    page,
    messages: en,
    books: [catalan, catalanA4],
    isMobile,
  };
  await page.goto('/');
  await startTodayReview(page, en);
  await expectCounter(page, 0, 2);
  const t = en.training.review.twoAnswers;
  const notice = page.getByRole('note');
  const field = page.getByLabel(en.board.moveInput.label, { exact: true });
  const seen: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const title =
      (await page.getByRole('heading', { level: 1 }).textContent()) ?? '';
    const other = OTHER.get(title);
    if (other === undefined) throw new Error(`asked in "${title}"`);
    await expect(notice).toContainText(t.title);
    await expect(notice).toContainText(format(t.item, other));
    if (i === 1) {
      // The other repertoire's move is a lapse here: the item expects
      // its own repertoire's move, and nothing is blocked.
      await field.fill(other.move);
      await field.press('Enter');
      await expect(page.getByText(en.training.review.lapse)).toBeVisible();
    }
    const asked = await answer(drill);
    expect(asked.book).toBe(title);
    seen.push(title);
    if (i === 0)
      await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(
        title,
      );
  }
  expect(new Set(seen)).toEqual(new Set([CATALAN, CATALAN_A4]));
  await expect(doneHeading(page, en)).toBeVisible();
});
