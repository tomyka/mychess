// S4 journeys (plan Task A18): C-M1-1, U1-M1-1, G-M1-1 and D-M1-1's
// accept part, a revoked invite, unlink ending access (checklist 3), and
// Coach mode refusing to switch off while players are linked (R-100).
// #381 part 5 (plan Task 17): the coach unlinks from the player page
// (R-44), and a group's New link replaces its open link while Revoke
// closes it (R-233).
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  coachReady,
  linkedPlayer,
  type Cast,
} from './support/assignment-people';
import {
  acceptInvite,
  createGroup,
  createInvite,
  expectInviteFrom,
  newGroupLink,
  openInviteSheet,
  signUpThroughInvite,
  switchOnCoachMode,
} from './support/coaching';
import {
  en,
  format,
  freshEmail,
  newDevice,
  newOnboardedAccount,
  onboard,
  signIn,
  test,
} from './support/journey';
import { openTab } from './support/nav';

const GROUP = 'Šeštadienio grupė';
const COACH = 'Rimantas Vaitkus';
const ROKAS = 'Rokas Petrauskas';
const GABIJA = 'Gabija Navickaitė';
const DOVYDAS = 'Dovydas Kazlauskas';
const PLAYERS = [ROKAS, GABIJA, DOVYDAS];

/** A section of /coach whose name carries its count ("Players · 3"). */
const countedRegion = (page: Page, title: string): Locator =>
  page.getByRole('region', { name: new RegExp(`^${title} · `, 'u') });

/** A page on a new device of its own, kept in `devices` to close later. */
async function onDevice(
  browser: Browser,
  devices: BrowserContext[],
): Promise<Page> {
  const context = await newDevice(browser);
  devices.push(context);
  return context.newPage();
}

/**
 * C-M1-1: Rimantas switches Coach mode on, makes the group and its invite.
 */
async function coachInvitesGroup(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  await newOnboardedAccount(page, request, COACH);
  await switchOnCoachMode(page, en);
  await openTab(page, en, 'coach');
  await expect(page).toHaveURL(/\/coach$/);
  // A new link from the group's page (R-232); the group's first one
  // (R-204) is used by the assignment and progress journeys.
  await createGroup(page, en, GROUP);
  return newGroupLink(page, en, GROUP);
}

/** U1-M1-1, G-M1-1, D-M1-1: three players accept; returns Rokas's page. */
async function threePlayersAccept(
  browser: Browser,
  devices: BrowserContext[],
  request: APIRequestContext,
  link: string,
): Promise<Page> {
  // Rokas, signed out, through sign-in and onboarding.
  const rokas = await onDevice(browser, devices);
  await signUpThroughInvite(rokas, request, {
    link,
    name: 'Rokas Petrauskas',
  });
  await expectInviteFrom(rokas, en, { coach: COACH, group: GROUP });
  await acceptInvite(rokas, en);
  // My coaches lists the coach (R-234 moved the "linked with" line to Today).
  await rokas.goto('/settings#coaches');
  await expect(
    rokas.getByRole('heading', { level: 3, name: COACH, exact: true }),
  ).toBeVisible();
  // Gabija, already signed in.
  const gabija = await onDevice(browser, devices);
  await newOnboardedAccount(gabija, request, 'Gabija Navickaitė');
  await gabija.goto(link);
  await expectInviteFrom(gabija, en, { coach: COACH, group: GROUP });
  await acceptInvite(gabija, en);
  // Dovydas, signed in and onboarded before he opens the invite.
  const dovydas = await onDevice(browser, devices);
  await signIn(dovydas, request, en, freshEmail());
  await onboard(dovydas, { name: 'Dovydas Kazlauskas' });
  await dovydas.goto(link);
  await expectInviteFrom(dovydas, en, { coach: COACH, group: GROUP });
  await acceptInvite(dovydas, en);
  return rokas;
}

/**
 * Checklist 3: after Rokas unlinks, his page is not found for the coach.
 */
async function unlinkEndsAccess(coach: Page, rokas: Page): Promise<void> {
  await coach.goto('/coach');
  await coach
    .getByRole('link', { name: 'Rokas Petrauskas', exact: true })
    .click();
  await expect(coach).toHaveURL(/\/coach\/players\//);
  await expect(coach.getByText('Rokas Petrauskas').first()).toBeVisible();
  const t = en.settings.myCoaches;
  await rokas.getByRole('button', { name: t.unlink }).click();
  await rokas.getByRole('button', { name: t.confirmUnlink }).click();
  await expect(rokas.getByText(t.empty)).toBeVisible();
  await coach.reload();
  await expect(coach.getByText(en.coach.notFound)).toBeVisible();
  await expect(coach.getByText('Rokas Petrauskas')).toHaveCount(0);
}

test(
  'C-M1-1, U1-M1-1, G-M1-1: one group invite brings three players into the group; unlink ends access',
  { tag: '@mobile' },
  async ({ page, request, browser }) => {
    test.setTimeout(240_000);
    const devices: BrowserContext[] = [];
    try {
      const link = await coachInvitesGroup(page, request);
      const rokas = await threePlayersAccept(browser, devices, request, link);

      await page.goto('/coach');
      await page.getByRole('link', { name: GROUP, exact: true }).click();
      await expect(page).toHaveURL(/\/coach\/groups\//);
      for (const name of PLAYERS)
        await expect(page.getByText(name, { exact: true })).toBeVisible();

      await unlinkEndsAccess(page, rokas);

      // R-100: Coach mode stays on while Gabija and Dovydas are linked.
      await page.goto('/settings');
      await page
        .getByRole('button', { name: en.settings.coachMode.switchOff })
        .click();
      await expect(page.getByText(en.coach.stillLinked)).toBeVisible();
      for (const name of PLAYERS.slice(1))
        await expect(page.getByRole('link', { name })).toBeVisible();
    } finally {
      for (const device of devices) await device.close();
    }
  },
);

test('a revoked invite says only that it is not valid, and offers no Accept', async ({
  page,
  request,
  browser,
}) => {
  await newOnboardedAccount(page, request, COACH);
  await switchOnCoachMode(page, en);
  await page.goto('/coach');
  const link = await createInvite(page, en);
  const t = en.coach.invites;
  // The open invite is listed by its dates in the sheet (R-232); Revoke
  // asks first.
  const sheet = await openInviteSheet(page, en);
  await sheet.getByRole('button', { name: t.revoke, exact: true }).click();
  await sheet
    .getByRole('button', { name: en.coach.inviteSheet.confirmRevoke })
    .click();
  // The list shows open invites only (#329): the revoked one leaves it.
  await expect(sheet.getByText(t.empty)).toBeVisible();
  await expect(sheet.getByRole('button', { name: t.revoke })).toHaveCount(0);

  const other = await newDevice(browser);
  try {
    const player = await other.newPage();
    await newOnboardedAccount(player, request, 'Rūta');
    await player.goto(link);
    await expect(player.getByText(en.invite.invalid)).toBeVisible();
    await expect(
      player.getByRole('button', { name: en.invite.accept }),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test('R-44: the coach unlinks a player from the player page, after confirming; the player leaves the dashboard', async ({
  page: coach,
  request,
  browser,
}) => {
  test.setTimeout(240_000);
  const devices: BrowserContext[] = [];
  const cast: Cast = { messages: en, browser, request, devices };
  try {
    await coachReady(coach, cast);
    const rokas = await linkedPlayer(cast, {
      link: await createInvite(coach, en),
      name: ROKAS,
    });
    await linkedPlayer(cast, {
      link: await createInvite(coach, en),
      name: GABIJA,
    });

    await coach.goto('/coach');
    const players = countedRegion(coach, en.coach.players.title);
    await players.getByRole('link', { name: ROKAS, exact: true }).click();
    await expect(coach).toHaveURL(/\/coach\/players\/[^/]+$/);
    const t = en.coach.players;
    const unlink = coach.getByRole('button', {
      name: format(en.coach.player.unlink, { name: ROKAS }),
      exact: true,
    });
    const question = coach.getByText(format(t.unlinkConfirm, { name: ROKAS }), {
      exact: true,
    });
    // It asks first; Cancel keeps him.
    await unlink.click();
    await expect(question).toBeVisible();
    await coach.getByRole('button', { name: t.cancel, exact: true }).click();
    await expect(question).toHaveCount(0);
    await unlink.click();
    await coach
      .getByRole('button', { name: t.confirmUnlink, exact: true })
      .click();

    await expect(coach).toHaveURL(/\/coach$/);
    await expect(
      countedRegion(coach, en.coach.players.title).getByRole('link', {
        name: GABIJA,
        exact: true,
      }),
    ).toBeVisible();
    await expect(coach.getByText(ROKAS)).toHaveCount(0);
    // His side: no coach left.
    await rokas.page.goto('/settings');
    await expect(
      rokas.page.getByText(en.settings.myCoaches.empty),
    ).toBeVisible();
  } finally {
    for (const device of devices) await device.close();
  }
});

test('R-233: a group’s New link replaces its open link, and Revoke closes the new one', async ({
  page: coach,
  request,
  browser,
}) => {
  test.setTimeout(240_000);
  const devices: BrowserContext[] = [];
  const cast: Cast = { messages: en, browser, request, devices };
  const invalid = async (link: string, name: string): Promise<void> => {
    const device = await newDevice(browser);
    devices.push(device);
    const page = await device.newPage();
    await newOnboardedAccount(page, request, name);
    await page.goto(link);
    await expect(page.getByText(en.invite.invalid)).toBeVisible();
    await expect(
      page.getByRole('button', { name: en.invite.accept }),
    ).toHaveCount(0);
  };
  try {
    await coachReady(coach, cast);
    const first = await createGroup(coach, en, GROUP);
    const second = await newGroupLink(coach, en, GROUP);
    expect(second).not.toBe(first);

    // The group's earlier link no longer works; the new one does.
    await invalid(first, ROKAS);
    await linkedPlayer(cast, { link: second, name: GABIJA, group: GROUP });

    // Revoke closes it without making another.
    const t = en.coach.group;
    await coach.reload();
    const section = coach.getByRole('region', {
      name: t.inviteTitle,
      exact: true,
    });
    const revoke = section.getByRole('button', {
      name: en.coach.invites.revoke,
      exact: true,
    });
    await revoke.click();
    await expect(
      section.getByText(t.revokeConfirm, { exact: true }),
    ).toBeVisible();
    await section
      .getByRole('button', {
        name: en.coach.inviteSheet.confirmRevoke,
        exact: true,
      })
      .click();
    await expect(
      section.getByText(t.noOpenLink, { exact: true }),
    ).toBeVisible();
    await expect(revoke).toHaveCount(0);
    await invalid(second, DOVYDAS);
  } finally {
    for (const device of devices) await device.close();
  }
});
