// S4 journeys (plan Task A18): C-M1-1, U1-M1-1, G-M1-1 and D-M1-1's
// accept part, a revoked invite, unlink ending access (checklist 3), and
// Coach mode refusing to switch off while players are linked (R-100).
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  acceptInvite,
  createGroup,
  createInvite,
  expectInviteFrom,
  signUpThroughInvite,
  switchOnCoachMode,
} from './support/coaching';
import {
  CATALOGUES,
  freshEmail,
  newDevice,
  newOnboardedAccount,
  onboard,
  signIn,
  test,
} from './support/journey';

const { lt, en } = CATALOGUES;

const GROUP = 'Šeštadienio grupė';
const COACH = 'Rimantas Vaitkus';
const PLAYERS = ['Rokas Petrauskas', 'Gabija Navickaitė', 'Dovydas Kazlauskas'];

/** A page on a new device of its own, kept in `devices` to close later. */
async function onDevice(
  browser: Browser,
  devices: BrowserContext[],
): Promise<Page> {
  const context = await newDevice(browser);
  devices.push(context);
  return context.newPage();
}

/** C-M1-1: Rimantas switches Coach mode on, makes the group and its invite. */
async function coachInvitesGroup(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  await newOnboardedAccount(page, request, COACH);
  await switchOnCoachMode(page, lt);
  await page.getByRole('link', { name: lt.settings.home }).click();
  await page.getByRole('link', { name: lt.app.coachArea }).click();
  await expect(page).toHaveURL(/\/treneris$/);
  await createGroup(page, lt, GROUP);
  return createInvite(page, lt, { kind: 'group', group: GROUP });
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
    locale: 'lt',
  });
  await expectInviteFrom(rokas, lt, { coach: COACH, group: GROUP });
  await acceptInvite(rokas, lt);
  await expect(rokas.getByText(COACH)).toBeVisible();
  // Gabija, already signed in.
  const gabija = await onDevice(browser, devices);
  await newOnboardedAccount(gabija, request, 'Gabija Navickaitė');
  await gabija.goto(link);
  await expectInviteFrom(gabija, lt, { coach: COACH, group: GROUP });
  await acceptInvite(gabija, lt);
  // Dovydas, in English.
  const dovydas = await onDevice(browser, devices);
  await signIn(dovydas, request, lt, freshEmail());
  await onboard(dovydas, { name: 'Dovydas Kazlauskas', locale: 'en' });
  await dovydas.goto(link);
  await expectInviteFrom(dovydas, en, { coach: COACH, group: GROUP });
  await acceptInvite(dovydas, en);
  return rokas;
}

/** Checklist 3: after Rokas unlinks, his page is not found for the coach. */
async function unlinkEndsAccess(coach: Page, rokas: Page): Promise<void> {
  await coach.goto('/treneris');
  await coach
    .getByRole('link', { name: 'Rokas Petrauskas', exact: true })
    .click();
  await expect(coach).toHaveURL(/\/treneris\/zaidejai\//);
  await expect(coach.getByText('Rokas Petrauskas').first()).toBeVisible();
  const t = lt.settings.myCoaches;
  await rokas.getByRole('button', { name: t.unlink }).click();
  await rokas.getByRole('button', { name: t.confirmUnlink }).click();
  await expect(rokas.getByText(t.empty)).toBeVisible();
  await coach.reload();
  await expect(coach.getByText(lt.coach.notFound)).toBeVisible();
  await expect(coach.getByText('Rokas Petrauskas')).toHaveCount(0);
}

test('C-M1-1, U1-M1-1, G-M1-1: one group invite brings three players into the group; unlink ends access', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(240_000);
  const devices: BrowserContext[] = [];
  try {
    const link = await coachInvitesGroup(page, request);
    const rokas = await threePlayersAccept(browser, devices, request, link);

    await page.reload();
    await page.getByRole('link', { name: GROUP, exact: true }).click();
    await expect(page).toHaveURL(/\/treneris\/grupes\//);
    for (const name of PLAYERS)
      await expect(page.getByText(name, { exact: true })).toBeVisible();

    await unlinkEndsAccess(page, rokas);

    // R-100: Coach mode stays on while Gabija and Dovydas are linked.
    await page.goto('/nustatymai');
    await page
      .getByRole('button', { name: lt.settings.coachMode.switchOff })
      .click();
    await expect(page.getByText(lt.coach.stillLinked)).toBeVisible();
    for (const name of PLAYERS.slice(1))
      await expect(page.getByRole('link', { name })).toBeVisible();
  } finally {
    for (const device of devices) await device.close();
  }
});

test('a revoked invite says only that it is not valid, and offers no Accept', async ({
  page,
  request,
  browser,
}) => {
  await newOnboardedAccount(page, request, COACH);
  await switchOnCoachMode(page, lt);
  await page.goto('/treneris');
  const link = await createInvite(page, lt, { kind: 'personal' });
  const t = lt.coach.invites;
  await page
    .getByRole('listitem')
    .filter({ hasText: t.state.active })
    .getByRole('button', { name: t.revoke })
    .click();
  await expect(page.getByText(t.state.revoked)).toBeVisible();

  const other = await newDevice(browser);
  try {
    const player = await other.newPage();
    await newOnboardedAccount(player, request, 'Rūta');
    await player.goto(link);
    await expect(player.getByText(lt.invite.invalid)).toBeVisible();
    await expect(
      player.getByRole('button', { name: lt.invite.accept }),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }
});
