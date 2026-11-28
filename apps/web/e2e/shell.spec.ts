// The app shell (#381, R-218): the tabs reach every area, an inner page
// names its parent and leads back to it, and a drill runs without the tabs.
import { expect } from '@playwright/test';
import { en, format, newOnboardedAccount, test } from './support/journey';
import { fromAccountMenu, mainNav, openTab } from './support/nav';
import { createRepertoire } from './support/repertoires';
import { expectSheetShape } from './support/sheet';

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

test(
  '#381 part 6: the account menu shows the email, is a bottom sheet on a phone, and its Settings leads back to the tab it was opened on',
  { tag: '@mobile' },
  async ({ page, request, isMobile }) => {
    const name = 'Gabija Navickaitė';
    const email = await newOnboardedAccount(page, request, name);
    await openTab(page, en, 'repertoires');
    await expect(page).toHaveURL(/\/repertoires$/u);

    const avatar = page.getByRole('button', { name: en.nav.account.open });
    await avatar.click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    // On a phone a sheet named by the display name, closed by Close; on a
    // desktop a dropdown, which Escape closes.
    const sheet = page.getByRole('dialog', { name });
    if (isMobile) {
      await expectSheetShape(page, sheet, true);
      await sheet
        .getByRole('button', { name: en.nav.account.close, exact: true })
        .click();
      await expect(sheet).toBeHidden();
    } else {
      await expect(sheet).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByText(email, { exact: true })).toBeHidden();
    }

    await fromAccountMenu(page, en, 'settings');
    await expect(page).toHaveURL(/\/settings\?from=repertoires$/u);
    await page
      .getByRole('link', {
        name: format(en.nav.back, { parent: en.nav.repertoires }),
      })
      .click();
    await expect(page).toHaveURL(/\/repertoires$/u);
  },
);
