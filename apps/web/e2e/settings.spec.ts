import { readFile } from 'node:fs/promises';
import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  COACH,
  ROKAS,
  coachReady,
  linkedPlayer,
  type Cast,
} from './support/assignment-people';
import { assignTo, fixture, importRepertoire } from './support/assignments';
import { createInvite } from './support/coaching';
import { linkIn, nextMailTo } from './support/mailpit';
import { expectSheetShape } from './support/sheet';
import {
  en,
  expectGreeting,
  format,
  freshEmail,
  newDevice,
  newOnboardedAccount,
  requestLink,
  signIn,
  test,
} from './support/journey';
import { fromAccountMenu } from './support/nav';

// The UI is English only and offers no language choice (#378).

/** From the account menu to settings. */
async function openSettings(page: Page): Promise<void> {
  await fromAccountMenu(page, en, 'settings');
  // The menu names the tab it was opened from (`?from=`, #381 part 6).
  await expect(page).toHaveURL(/\/settings(\?from=\w+)?$/u);
}

/** In settings: a new display name, saved. */
async function rename(page: Page, name: string): Promise<void> {
  await page
    .getByLabel(en.settings.profile.displayName, { exact: true })
    .fill(name);
  // The Account card's own Save: the training limits have one too (S6).
  const account = page.getByRole('region', { name: en.settings.account.title });
  await account
    .getByRole('button', { name: en.settings.profile.submit })
    .click();
  await expect(
    account.getByRole('status').filter({ hasText: en.settings.saved }),
  ).toBeVisible();
}

test('settings offer no language choice; a changed name shows at once, in English', async ({
  page,
  request,
}) => {
  await newOnboardedAccount(page, request, 'Gabija');
  await openSettings(page);
  await expect(page.getByRole('radio')).toHaveCount(0);

  await rename(page, 'Gabija N.');
  await page
    .getByRole('link', { name: format(en.nav.back, { parent: en.nav.today }) })
    .click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expectGreeting(page, en, 'Gabija N.');
});

test('G-M1-5: a name changed in settings greets the account on every device', async ({
  page,
  request,
  browser,
}) => {
  const email = await newOnboardedAccount(page, request, 'Gabija');
  await openSettings(page);
  await rename(page, 'Gabija N.');

  const other = await newDevice(browser);
  try {
    const phone = await other.newPage();
    await signIn(phone, request, en, email);
    await expect(phone).toHaveURL(/\/$/);
    await expect(phone.locator('html')).toHaveAttribute('lang', 'en');
    await expectGreeting(phone, en, 'Gabija N.');
  } finally {
    await other.close();
  }
});

test('D-M3-5 (S1 part): the export link downloads JSON with the account email', async ({
  page,
  request,
}) => {
  const email = await newOnboardedAccount(page, request, 'Dovydas');
  await openSettings(page);

  const downloading = page.waitForEvent('download');
  await page
    .getByRole('link', { name: en.settings.export.download, exact: true })
    .click();
  const download = await downloading;

  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const text = await readFile(await download.path(), 'utf8');
  const data: unknown = JSON.parse(text);
  expect(JSON.stringify(data)).toContain(email);
});

test('deleting needs the exact display name, mails a confirmation, and frees the email for a new account', async ({
  page,
  request,
}) => {
  const email = await newOnboardedAccount(page, request, 'Rokas P');
  await openSettings(page);
  await page.getByRole('button', { name: en.settings.delete.open }).click();
  await expect(
    page.getByRole('dialog', { name: en.settings.delete.title }),
  ).toBeVisible();
  const typed = page.getByLabel(
    format(en.settings.delete.typeName, { name: 'Rokas P' }),
    { exact: true },
  );
  const confirm = page.getByRole('button', {
    name: en.settings.delete.confirm,
  });

  await expect(confirm).toBeDisabled();
  await typed.fill('Rokas');
  await expect(confirm).toBeDisabled();
  await typed.fill('Rokas P');
  await expect(confirm).toBeEnabled();

  const mail = await nextMailTo(request, email, async () => {
    await confirm.click();
    await expect(page).toHaveURL(/\/sign-in\?deleted=1$/);
  });
  expect(mail.Subject).toBe(en.mail.deleted.subject);
  await expect(page.getByRole('status')).toHaveText(en.signIn.deleted);

  // The old account is gone: the same email starts over at onboarding.
  const again = await requestLink(page, request, en, {
    typed: email,
    inbox: email,
  });
  await page.goto(linkIn(again.Text));
  await expect(page).toHaveURL(/\/welcome$/);
});

test('an account that has not finished onboarding deletes itself by typing its email (R-86)', async ({
  page,
  request,
}) => {
  const email = freshEmail();
  await signIn(page, request, en, email);
  await expect(page).toHaveURL(/\/welcome$/);

  // The quiet link under the card opens the delete sheet, and the page
  // behind it does not move (finding 23).
  const heading = page.getByRole('heading', {
    level: 1,
    name: en.onboarding.title,
  });
  const before = await heading.boundingBox();
  await page.getByRole('button', { name: en.settings.delete.open }).click();
  await expect(
    page.getByRole('dialog', { name: en.settings.delete.title }),
  ).toBeVisible();
  expect((await heading.boundingBox())?.y).toBe(before?.y);
  const typed = page.getByLabel(
    format(en.settings.delete.typeEmail, { email }),
    { exact: true },
  );
  const confirm = page.getByRole('button', {
    name: en.settings.delete.confirm,
  });
  await expect(confirm).toBeDisabled();
  await typed.fill('e2e-someone-else@mychess.test');
  await expect(confirm).toBeDisabled();
  await typed.fill(email.toUpperCase());
  await expect(confirm).toBeEnabled();

  const mail = await nextMailTo(request, email, async () => {
    await confirm.click();
    await expect(page).toHaveURL(/\/sign-in\?deleted=1$/);
  });
  expect(mail.Subject).toBe(en.mail.deleted.subject);
});

/** Rokas's Italian (docs/personas/u1400.md), as assignments.spec.ts imports it. */
const ITALIAN = 'Itališkoji partija';

/** Settings' cards, most used first (#381 part 6). */
const CARD_ORDER = [
  en.training.settings.title,
  en.settings.myCoaches.title,
  en.settings.account.title,
  en.settings.coachMode.title,
  en.settings.export.title,
];

test(
  'R-237: settings cards come most used first, My coaches lists what the coach assigns, and Delete account opens a sheet',
  { tag: '@mobile' },
  async ({ page: coach, request, browser, isMobile }) => {
    test.setTimeout(240_000);
    const devices: BrowserContext[] = [];
    const cast: Cast = { messages: en, browser, request, devices };
    try {
      await coachReady(coach, cast);
      const rokas = await linkedPlayer(cast, {
        link: await createInvite(coach, en),
        name: ROKAS,
      });
      await importRepertoire(coach, en, {
        file: fixture('italiskoji.pgn'),
        side: 'white',
        name: ITALIAN,
      });
      await assignTo(coach, en, { target: ROKAS });

      const page = rokas.page;
      await page.goto('/');
      await openSettings(page);
      await expect(
        page.getByRole('main').getByRole('heading', { level: 2 }),
      ).toHaveText(CARD_ORDER);

      // My coaches: the coach, and under Assigned the Italian, no deadline.
      const t = en.settings.myCoaches;
      const coaches = page.getByRole('region', { name: t.title, exact: true });
      await expect(
        coaches.getByRole('heading', { level: 3, name: COACH, exact: true }),
      ).toBeVisible();
      const assigned = coaches
        .getByRole('list', { name: t.assigned, exact: true })
        .getByRole('listitem');
      await expect(assigned).toHaveCount(1);
      await expect(assigned.getByText(ITALIAN, { exact: true })).toBeVisible();
      await expect(
        assigned.getByText(en.coach.status.noDeadline, { exact: true }),
      ).toBeVisible();

      // Delete account…: a bottom sheet on a phone, a dialog on a desktop;
      // Cancel closes it and gives focus back to the button.
      const open = page.getByRole('button', {
        name: en.settings.delete.open,
        exact: true,
      });
      await open.click();
      const sheet = page.getByRole('dialog', {
        name: en.settings.delete.title,
      });
      await expectSheetShape(page, sheet, isMobile);
      await sheet
        .getByRole('button', { name: en.settings.delete.cancel, exact: true })
        .click();
      await expect(sheet).toBeHidden();
      await expect(open).toBeFocused();
    } finally {
      for (const device of devices) await device.close();
    }
  },
);

/**
 * `heading` is scrolled to: in the top quarter of the window. Unscrolled,
 * My coaches' heading is already in view near the bottom (y 675 of 720 on
 * desktop, 607 of 839 on Pixel 7), so "in the viewport" would not tell.
 */
async function expectNearTop(page: Page, heading: Locator): Promise<void> {
  await expect(heading).toBeInViewport();
  await expect
    .poll(async () => (await heading.boundingBox())?.y ?? Infinity)
    .toBeLessThan((page.viewportSize()?.height ?? 0) / 4);
}

test(
  '#403: My coaches opened by its address scrolls to its card, on load and on reload',
  { tag: '@mobile' },
  async ({ page, request }) => {
    await newOnboardedAccount(page, request, 'Austėja Žukauskaitė');
    const heading = page.getByRole('heading', {
      level: 2,
      name: en.settings.myCoaches.title,
      exact: true,
    });
    await page.goto('/settings#coaches');
    await expectNearTop(page, heading);
    await page.reload();
    await expectNearTop(page, heading);
  },
);
