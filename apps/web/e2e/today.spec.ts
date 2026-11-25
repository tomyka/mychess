// Today (#381 part 2, R-221, R-222): a new player's empty hero, then the
// learn hero and the row of the repertoire they import, whose Learn trains
// that repertoire alone; the tab bar stays on Today.
import { expect } from '@playwright/test';
import { importRepertoire } from './support/assignments';
import { en, format, newOnboardedAccount, test } from './support/journey';
import { mainNav } from './support/nav';
import { plural } from './support/repertoires';
import { ownKeys } from './support/training';
import { ITALIAN, ITALIAN_PGN, italian } from './support/training-cast';
import { rowAction, today, todayList, todayRow } from './support/today';

/** A new account's daily allowance of new moves (R-146). */
const NEW_PER_DAY = 10;

test(
  'Today: the empty hero, then an imported repertoire’s learn hero and row, whose Learn trains it',
  { tag: '@mobile' },
  async ({ page, request }) => {
    test.setTimeout(120_000);
    await newOnboardedAccount(page, request, 'Rokas Petrauskas');
    await page.goto('/');
    const hero = today(page, en);
    const nav = mainNav(page, en);
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: en.nav.today })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Nothing to train yet: a welcome, two ways to start, and no list.
    await expect(
      hero.getByText(en.today.welcome, { exact: true }),
    ).toBeVisible();
    await expect(
      hero.getByRole('link', { name: en.today.create, exact: true }),
    ).toBeVisible();
    await expect(
      hero.getByRole('link', { name: en.today.import, exact: true }),
    ).toBeVisible();
    await expect(todayList(page, en)).toHaveCount(0);

    await importRepertoire(page, en, {
      file: ITALIAN_PGN,
      side: 'white',
      name: ITALIAN,
    });
    await page.goto('/');
    // Nothing due, the day's new moves to learn.
    await expect(
      hero.getByText(en.training.today.nothingDue, { exact: true }),
    ).toBeVisible();
    const learn = Math.min(NEW_PER_DAY, ownKeys(italian).length);
    await expect(
      hero.getByRole('link', {
        name: plural(en.training.today.learn, { count: learn }),
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      hero.getByRole('link', { name: en.training.today.start }),
    ).toHaveCount(0);
    // Its row: White, none learned yet, and Learn.
    const row = todayRow(page, en, ITALIAN);
    await expect(row.getByText(en.repertoires.create.white)).toBeVisible();
    await expect(
      row.getByText(format(en.coach.progress.percent, { percent: '0' }), {
        exact: true,
      }),
    ).toBeVisible();
    await rowAction(row, en).click();
    await expect(page).toHaveURL(/\/training\?mode=learn&r=[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ITALIAN);
  },
);
