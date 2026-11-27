// #330 journeys for learning with the arrows off (R-205, decision 1): the
// setting, then a new move asked blind, learned on the first right answer,
// its arrow only after a wrong one (D-M1, the 2000+ tester's ask). With
// the arrows off a blind ask is treated like a review ask (lead answer 3,
// R-174): a coach note shows once the move is answered, right or wrong,
// and holds a right answer until Next.
import { expect, type BrowserContext, type Page } from '@playwright/test';
import {
  COACH,
  DOVYDAS,
  ROKAS,
  coachReady,
  linkedPlayer,
  type Cast,
} from './support/assignment-people';
import { assignTo, importRepertoire } from './support/assignments';
import { createInvite } from './support/coaching';
import { en, format, newOnboardedAccount, test } from './support/journey';
import { storedReviews } from './support/training-db';
import {
  answer,
  drillToDone,
  expectCounter,
  nextButton,
  setTrainingLimits,
  type Drill,
} from './support/training';
import {
  CATALAN,
  CATALAN_PGN,
  ITALIAN,
  ITALIAN_PGN,
  arrow,
  catalan,
  italian,
  stat,
  trainLink,
} from './support/training-cast';

/** The coach's comments on 3.Bc4 and 4.c3 (fixtures/italiskoji.pgn). */
const BC4_COMMENT = 'Rikis taikosi į f7 langelį.';
const C3_COMMENT = 'Ruošiame d4, bet neskubame.';

test('D-M1 arrows off (R-205): Dovydas learns blind: no arrow, a right move learned at once, a wrong one shows the arrow', async ({
  page,
  request,
  isMobile,
}) => {
  test.setTimeout(180_000);
  const email = await newOnboardedAccount(page, request, DOVYDAS);
  await setTrainingLimits(page, en, { learnArrows: false });
  await importRepertoire(page, en, {
    file: CATALAN_PGN,
    side: 'white',
    name: CATALAN,
  });
  const drill: Drill = { page, messages: en, books: [catalan], isMobile };
  await trainLink(page, en, 'learn', 10).click();
  await expectCounter(page, 0, 10);
  // The first new move: asked without its arrow.
  await expect(arrow(page)).toHaveCount(0);
  const first = await answer(drill);
  expect([first.move.san, first.prompt]).toEqual([
    'd4',
    en.training.learn.recall,
  ]);
  // Right on the first ask: learned at once, not asked a second time.
  await expect(async () => {
    const keys = (await storedReviews(email)).map((r) => r.move_key);
    expect(keys).toContain(`${first.key}|${first.move.san}`);
  }).toPass({ timeout: 10_000 });
  // A wrong move brings the arrow.
  await expect(arrow(page)).toHaveCount(0);
  const missed = await answer(drill, 'wrong');
  expect(missed.prompt).toBe(en.training.learn.recall);
  await expect(page.getByText(en.training.learn.wrong)).toBeVisible();
  await expect(arrow(page)).toHaveCount(1);
  await drillToDone(drill);
  await expect(stat(page, en.training.done.learned)).toHaveText('10');
  await expect(async () => {
    const reviews = await storedReviews(email);
    expect(reviews).toHaveLength(10);
    for (const review of reviews) expect(review.learned_at).not.toBeNull();
  }).toPass({ timeout: 10_000 });
});

/**
 * The coach assigns his Italian to a linked Rokas, who has the arrows off;
 * Rokas opens its learn pass. Rokas's page.
 */
async function rokasLearnsAssigned(coach: Page, cast: Cast): Promise<Page> {
  await coachReady(coach, cast);
  const link = await createInvite(coach, en);
  const { page: rokas } = await linkedPlayer(cast, { link, name: ROKAS });
  await importRepertoire(coach, en, {
    file: ITALIAN_PGN,
    side: 'white',
    name: ITALIAN,
  });
  await assignTo(coach, en, { target: ROKAS });
  await setTrainingLimits(rokas, en, { newPerDay: 8, learnArrows: false });
  await rokas.goto('/');
  await rokas.getByRole('link', { name: ITALIAN, exact: true }).click();
  await expect(rokas).toHaveURL(/\/repertoires\/assigned\//);
  await trainLink(rokas, en, 'learn', 8).click();
  return rokas;
}

test(
  'R-174 with the arrows off: Rokas learns his coach’s Italian; the note shows after the answer and holds a right one until Next',
  { tag: '@mobile' },
  async ({ page: coach, request, browser, isMobile }) => {
    test.setTimeout(300_000);
    const devices: BrowserContext[] = [];
    const cast: Cast = {
      messages: en,
      browser,
      request,
      devices,
    };
    try {
      const rokas = await rokasLearnsAssigned(coach, cast);
      await expectCounter(rokas, 0, 8);
      const drill: Drill = {
        page: rokas,
        messages: en,
        books: [italian],
        isMobile,
      };
      const note = rokas.getByRole('note', {
        name: en.training.drill.coachNote,
      });
      for (const san of ['e4', 'Nf3']) {
        expect((await answer(drill)).move.san).toBe(san);
        await expect(note).toHaveCount(0);
      }
      // 3.Bc4, right: the note shows now, and the drill waits for Next.
      const bc4 = await answer(drill);
      expect([bc4.move.san, bc4.prompt]).toEqual([
        'Bc4',
        en.training.learn.recall,
      ]);
      await expect(note).toContainText(BC4_COMMENT);
      await expect(note).toContainText(
        format(en.coachNote.byCoach, { name: COACH }),
      );
      await expect(nextButton(drill)).toBeVisible();
      await nextButton(drill).click();
      await expect(note).toHaveCount(0);
      // 4.c3, wrong: the note shows with the arrow.
      const c3 = await answer(drill, 'wrong');
      expect(c3.move.san).toBe('c3');
      await expect(rokas.getByText(en.training.learn.wrong)).toBeVisible();
      await expect(arrow(rokas)).toHaveCount(1);
      await expect(note).toContainText(C3_COMMENT);
      await drillToDone(drill);
      await expect(stat(rokas, en.training.done.learned)).toHaveText('8');
    } finally {
      for (const device of devices) await device.close();
    }
  },
);
