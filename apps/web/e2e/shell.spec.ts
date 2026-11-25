// The app shell (#381, R-218): the tabs reach every area, an inner page
// names its parent and leads back to it, and a drill runs without the tabs.
import { expect } from '@playwright/test';
import { en, format, newOnboardedAccount, test } from './support/journey';
import { mainNav, openTab } from './support/nav';
import { createRepertoire } from './support/repertoires';

test(
  'R-218: the tabs reach every area, an inner page leads back up, and a drill has no tabs',
  { tag: '@mobile' },
  async ({ page, request }) => {
    await newOnboardedAccount(page, request, 'Rokas Petrauskas');
    const nav = mainNav(page, en);
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: en.nav.today })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await openTab(page, en, 'repertoires');
    await expect(page).toHaveURL(/\/repertoires$/);
    await page.getByRole('link', { name: en.repertoires.list.import }).click();
    await expect(page).toHaveURL(/\/repertoires\/import$/);
    await expect(nav).toBeVisible();
    await page
      .getByRole('link', {
        name: format(en.nav.back, { parent: en.nav.repertoires }),
      })
      .click();
    await expect(page).toHaveURL(/\/repertoires$/);

    // A board page is an inner page too: it keeps the tabs and leads back.
    await createRepertoire(page, en, {
      name: 'Londono sistema',
      side: 'white',
    });
    await expect(nav).toBeVisible();
    await page
      .getByRole('link', {
        name: format(en.nav.back, { parent: en.nav.repertoires }),
      })
      .click();
    await expect(page).toHaveURL(/\/repertoires$/);

    // A player without Coach mode has no Coach tab.
    await openTab(page, en, 'opponents');
    await expect(page).toHaveURL(/\/fide$/);
    await expect(nav.getByRole('link', { name: en.nav.coach })).toHaveCount(0);

    await page.goto('/training?mode=review');
    await expect(nav).toHaveCount(0);
  },
);
