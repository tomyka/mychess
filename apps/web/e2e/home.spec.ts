import { expect } from '@playwright/test';
import { importRepertoire } from './support/assignments';
import {
  CATALOGUES,
  format,
  LOCALE_COOKIE,
  newOnboardedAccount,
  test,
} from './support/journey';
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
  startTodayReview,
  today,
} from './support/training-cast';

const { en } = CATALOGUES;

test('a signed-out visitor to the home page lands on sign-in, in English (R-180)', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/prisijungti$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('sign-in stays English when the locale cookie says lt (R-180)', async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error('playwright.config sets baseURL');
  await page
    .context()
    .addCookies([{ name: LOCALE_COOKIE, value: 'lt', url: baseURL }]);

  await page.goto('/');

  await expect(page).toHaveURL(/\/prisijungti$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('R-207: home lists each repertoire’s due moves, most urgent first; Start review is titled as several; each link reviews one', async ({
  page,
  request,
  isMobile,
}) => {
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
  const due = (name: string, side: 'white' | 'black', count: number) =>
    format(en.training.today.repertoireDue, {
      name,
      side: en.repertoires.create[side],
      count: String(count),
    });
  await page.goto('/');
  const block = today(page, en);
  await expect(block.getByRole('listitem')).toHaveText([
    due(KARO_KAN, 'black', 3),
    due(ITALIAN, 'white', 2),
  ]);
  // Start review trains both: titled as several, the item's under it.
  await startTodayReview(page, en);
  await expectCounter(page, 0, 5);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    en.training.title.mixed,
  );
  expect(await itemRepertoire(page, en)).toBe(KARO_KAN);
  // The Italian's link: its two due moves alone, under its own name.
  await page.goto('/');
  await block
    .getByRole('link', { name: due(ITALIAN, 'white', 2), exact: true })
    .click();
  await expect(page).toHaveURL(/\/treniruote\?mode=review&r=[0-9a-f-]{36}$/);
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
  await page.goto('/');
  await expect(block.getByRole('listitem')).toHaveText([
    due(KARO_KAN, 'black', 3),
  ]);
});
