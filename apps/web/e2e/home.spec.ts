import { expect } from '@playwright/test';
import { importRepertoire } from './support/assignments';
import { en, format, newOnboardedAccount, test } from './support/journey';
import { seedDue } from './support/training-db';
import {
  drillToDone,
  expectCounter,
  itemRepertoire,
  ownKeys,
  type Drill,
} from './support/training';
import {
  ITALIAN,
  ITALIAN_PGN,
  KARO_KAN,
  KARO_KAN_PGN,
  italian,
  karoKan,
} from './support/training-cast';
import {
  expectDue,
  rowAction,
  startTodayReview,
  todayList,
  todayRow,
} from './support/today';

test('a signed-out visitor to the home page lands on sign-in, in English', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test(
  'R-207: Today lists each repertoire with its due moves, most urgent first; Start review is titled as several; each row reviews one',
  { tag: '@mobile' },
  async ({ page, request, isMobile }) => {
    test.setTimeout(180_000);
    const email = await newOnboardedAccount(page, request, 'Gabija Navickaitė');
    for (const [file, side, name] of [
      [ITALIAN_PGN, 'white', ITALIAN],
      [KARO_KAN_PGN, 'black', KARO_KAN],
    ] as const)
      await importRepertoire(page, en, { file, side, name });
    // The Caro-Kann's three are the most overdue, then the Italian's two.
    await seedDue(email, [
      ...ownKeys(karoKan).slice(0, 3),
      ...ownKeys(italian).slice(0, 2),
    ]);
    await page.goto('/');
    await expectDue(page, en, 5);
    // One row each, the most urgent first, each with its side and count.
    const rows = todayList(page, en).getByRole('listitem');
    await expect(rows).toHaveCount(2);
    for (const [i, name, side, due] of [
      [0, KARO_KAN, 'black', 3],
      [1, ITALIAN, 'white', 2],
    ] as const) {
      const row = rows.nth(i);
      await expect(row.getByRole('link', { name, exact: true })).toBeVisible();
      await expect(
        row.getByText(en.repertoires.create[side], { exact: true }),
      ).toBeVisible();
      await expect(rowAction(row, en, due)).toBeVisible();
    }
    // Start review trains both: titled as several, the item's under it.
    await startTodayReview(page, en);
    await expectCounter(page, 0, 5);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      en.training.title.mixed,
    );
    expect(await itemRepertoire(page, en)).toBe(KARO_KAN);
    // The Italian row's Review 2: its two due moves alone, under its name.
    await page.goto('/');
    await rowAction(todayRow(page, en, ITALIAN), en, 2).click();
    await expect(page).toHaveURL(/\/training\?mode=review&r=[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ITALIAN);
    await expectCounter(page, 0, 2);
    const drill: Drill = {
      page,
      messages: en,
      books: [italian, karoKan],
      isMobile,
    };
    const asked = await drillToDone(drill);
    expect(asked.map((a) => a.book)).toEqual([ITALIAN, ITALIAN]);
    // Back on Today only the Caro-Kann has a review; the Italian row stays.
    await page.goto('/');
    await expectDue(page, en, 3);
    await expect(rowAction(todayRow(page, en, KARO_KAN), en, 3)).toBeVisible();
    const review = format(en.today.review, { count: '' }).trim();
    await expect(
      todayRow(page, en, ITALIAN).getByRole('link', {
        name: new RegExp(`^${review}`),
      }),
    ).toHaveCount(0);
  },
);
