// S5 journeys (plan Task C8): C-M1-3 (a group assignment, and a member who
// joins later with the R-16 deadline), C-M1-4 (an individual assignment with
// Lithuanian comments as coach notes), C-M1-6 (leaving the group takes the
// group assignment and offers a copy; coming back restores it), a coach edit
// ("Updated" and the summary, once), and pause, resume and "make my own
// copy" (R-46, R-47, R-128). Every account works in the test's language; the
// repertoires' names and comments are the coach's own Lithuanian.
import { expect, type BrowserContext, type Page } from '@playwright/test';
import {
  COACH,
  DOVYDAS,
  FOURTH,
  GABIJA,
  GROUP,
  ROKAS,
  changeGroupDeadline,
  coachReady,
  expectAssigned,
  playerAccepts,
  setInGroup,
  type Cast,
} from './support/assignment-people';
import {
  assignmentRow,
  assignTo,
  badge,
  fixture,
  forkOffers,
  fromMyCoach,
  homeAssignment,
  importRepertoire,
  untilAfterReload,
  vilniusDay,
} from './support/assignments';
import { createGroup, createInvite } from './support/coaching';
import { CATALOGUES, format, test } from './support/journey';
import { chip, typeMove } from './support/repertoires';

const KARO_KAN = 'Karo-Kan gynyba: pagrindai';
const ITALIAN = 'Itališkoji partija';
/**
 * The five Caro-Kann lines of docs/personas/coach.md (Black) and Rokas's
 * eight Italian lines of docs/personas/u1400.md (White), with the coach's
 * Lithuanian comments on 3.Bc4 and 4.c3 of the first chapter. Both import
 * with no game skipped (checked with @mychess/chess `importPgn`).
 */
const KARO_KAN_PGN = fixture('karo-kan.pgn');
const ITALIAN_PGN = fixture('italiskoji.pgn');
const C3_COMMENT = 'Ruošiame d4, bet neskubame.';

/** The page of `name` among the coach's repertoires. */
async function openOwn(coach: Page, name: string): Promise<void> {
  await coach.goto('/repertuarai');
  await coach.getByRole('link', { name: new RegExp(`^${name}`) }).click();
  await expect(coach.getByRole('heading', { level: 1 })).toHaveText(name);
}

/** The assigned page's coach note on 4.c3 (R-102), and no builder. */
async function expectCoachNote(page: Page, cast: Cast): Promise<void> {
  const { messages } = cast;
  const r = messages.repertoires;
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ITALIAN);
  await chip(page, `4. c3, ${r.moves.hasComment}`).click();
  const note = page.getByRole('region', {
    name: format(messages.coachNote.byCoach, { name: COACH }),
  });
  await expect(note.getByText(C3_COMMENT)).toBeVisible();
  await expect(page.getByRole('switch', { name: r.mode.build })).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: r.builder.commentLabel }),
  ).toHaveCount(0);
}

/** The assigned page's "not assigned to you" (plan decision 12). */
async function expectNotAssigned(page: Page, cast: Cast): Promise<void> {
  const name = cast.messages.assignment.page.notFound;
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText(C3_COMMENT)).toHaveCount(0);
}

/** C-M1-3: the Caro-Kann to the group; each member has it. Its deadline. */
async function assignToGroup(
  coach: Page,
  cast: Cast,
  members: readonly Page[],
): Promise<string> {
  const deadline = vilniusDay(61);
  await importRepertoire(coach, cast.messages, {
    file: KARO_KAN_PGN,
    side: 'black',
    name: KARO_KAN,
  });
  await assignTo(coach, cast.messages, { target: GROUP, deadline });
  const row = assignmentRow(coach, cast.messages, GROUP);
  for (const name of [ROKAS, GABIJA, DOVYDAS])
    await expect(row.getByText(name, { exact: true })).toBeVisible();
  for (const member of members) {
    await member.reload();
    await expectAssigned(member, cast, KARO_KAN, deadline);
  }
  return deadline;
}

/**
 * C-M1-4: the Italian to Rokas only. He reads its comments as Rimantas's
 * notes; Gabija neither lists it nor opens it. Returns its assigned page.
 */
async function assignToRokas(
  coach: Page,
  cast: Cast,
  { rokas, gabija }: { rokas: Page; gabija: Page },
): Promise<string> {
  const { messages } = cast;
  await importRepertoire(coach, messages, {
    file: ITALIAN_PGN,
    side: 'white',
    name: ITALIAN,
  });
  await chip(coach, `4. c3, ${messages.repertoires.moves.hasComment}`).click();
  await expect(coach.getByText(C3_COMMENT)).toBeVisible();
  await assignTo(coach, messages, { target: ROKAS });
  await rokas.reload();
  await expectAssigned(rokas, cast, ITALIAN, null);
  await rokas.getByRole('link', { name: ITALIAN, exact: true }).click();
  await expect(rokas).toHaveURL(/\/repertuarai\/priskirti\/[0-9a-f-]{36}$/);
  await expectCoachNote(rokas, cast);
  await gabija.reload();
  await expect(homeAssignment(gabija, messages, KARO_KAN)).toBeVisible();
  await expect(
    gabija.getByRole('link', { name: ITALIAN, exact: true }),
  ).toHaveCount(0);
  await gabija.goto(rokas.url());
  await expectNotAssigned(gabija, cast);
  return rokas.url();
}

/**
 * C-M1-3, R-16: a member who joins later gets the group's deadline while it
 * is ahead, and their join day once the group's date is past (not overdue).
 */
async function laterMember(
  coach: Page,
  cast: Cast,
  { link, deadline }: { link: string; deadline: string },
): Promise<void> {
  const fourth = await playerAccepts(cast, {
    link,
    name: FOURTH,
    group: GROUP,
  });
  await expectAssigned(fourth, cast, KARO_KAN, deadline);
  await openOwn(coach, KARO_KAN);
  await changeGroupDeadline(coach, cast.messages, vilniusDay(-1));
  await fourth.reload();
  await expectAssigned(fourth, cast, KARO_KAN, vilniusDay(0));
  const item = homeAssignment(fourth, cast.messages, KARO_KAN);
  await expect(badge(item, cast.messages, 'overdue')).toHaveCount(0);
}

/**
 * C-M1-6: out of the group, the Caro-Kann leaves Rokas's list and a copy
 * is offered while his own Italian stays; back in, it returns and the offer
 * closes.
 */
async function leaveAndRejoin(
  coach: Page,
  cast: Cast,
  rokas: Page,
): Promise<void> {
  const { messages } = cast;
  await setInGroup(coach, messages, { name: ROKAS, member: false });
  await rokas.goto('/');
  await expect(
    rokas.getByRole('link', { name: KARO_KAN, exact: true }),
  ).toHaveCount(0);
  await expectAssigned(rokas, cast, ITALIAN, null);
  const offers = forkOffers(rokas, messages);
  await expect(
    offers.getByRole('heading', { name: KARO_KAN, exact: true }),
  ).toBeVisible();
  await expect(
    offers.getByRole('button', { name: messages.forkOffer.keep }),
  ).toBeVisible();

  await setInGroup(coach, messages, { name: ROKAS, member: true });
  await rokas.reload();
  await expect(homeAssignment(rokas, messages, KARO_KAN)).toBeVisible();
  await expectAssigned(rokas, cast, ITALIAN, null);
  await expect(forkOffers(rokas, messages)).toHaveCount(0);
}

/** The coach adds 9.h3 after 8...Ba7 in the Italian's first chapter. */
async function coachAddsMove(coach: Page, cast: Cast): Promise<void> {
  const { messages } = cast;
  await coach
    .getByRole('switch', { name: messages.repertoires.mode.build })
    .click();
  await chip(coach, '8... Ba7').click();
  await typeMove(coach, messages, 'h3');
  await coach.reload();
  await expect(chip(coach, '9. h3')).toBeVisible();
}

/**
 * R-133: "Updated" on home and what changed on the page; once opened,
 * neither. Returns the assigned page.
 */
async function updatedOnce(rokas: Page, cast: Cast): Promise<string> {
  const { messages } = cast;
  const t = messages.assignment.changes;
  const item = homeAssignment(rokas, messages, ITALIAN);
  await rokas.reload();
  await expect(badge(item, messages, 'updated')).toBeVisible();
  await item.getByRole('link', { name: ITALIAN, exact: true }).click();
  await expect(rokas).toHaveURL(/\/repertuarai\/priskirti\//);
  const summary = rokas.getByRole('region', { name: t.title });
  const added = format(t.added, { moves: '9. h3' });
  await expect(summary.getByText(added).first()).toBeVisible();
  const assigned = rokas.url();
  await rokas.goto('/');
  await untilAfterReload(rokas, async () => {
    await expect(badge(item, messages, 'updated')).toHaveCount(0, {
      timeout: 2_000,
    });
  });
  await rokas.goto(assigned);
  await expect(rokas.getByRole('heading', { level: 1 })).toHaveText(ITALIAN);
  await expect(rokas.getByRole('region', { name: t.title })).toHaveCount(0);
  return assigned;
}

/** R-46: Rokas pauses (home and the coach show it), then resumes. */
async function pauseAndResume(
  rokas: Page,
  coach: Page,
  cast: Cast,
): Promise<void> {
  const { messages } = cast;
  const t = messages.assignment.pause;
  const item = homeAssignment(rokas, messages, ITALIAN);
  const assigned = rokas.url();
  await rokas.getByRole('button', { name: t.pause, exact: true }).click();
  const resume = rokas.getByRole('button', { name: t.resume, exact: true });
  await expect(resume).toBeVisible();
  await expect(rokas.getByText(t.pausedHint)).toBeVisible();
  await rokas.goto('/');
  await expect(badge(item, messages, 'paused')).toBeVisible();
  await coach.reload();
  const row = assignmentRow(coach, messages, ROKAS);
  await expect(badge(row, messages, 'paused')).toBeVisible();
  await rokas.goto(assigned);
  await resume.click();
  await expect(
    rokas.getByRole('button', { name: t.pause, exact: true }),
  ).toBeVisible();
  await rokas.goto('/');
  await expect(item).toBeVisible();
  await expect(badge(item, messages, 'paused')).toHaveCount(0);
  await rokas.goto(assigned);
}

/**
 * R-47, R-128: "Make my own copy" opens the copy, where the coach's comment
 * is a read-only note under his name; the assignment leaves home, and the
 * coach sees "forked".
 */
async function makeOwnCopy(
  rokas: Page,
  coach: Page,
  cast: Cast,
): Promise<void> {
  const { messages } = cast;
  const t = messages.assignment.fork;
  const r = messages.repertoires;
  const assigned = rokas.url();
  await rokas.getByRole('button', { name: t.label, exact: true }).click();
  await expect(
    rokas.getByText(format(t.question, { name: ITALIAN })),
  ).toBeVisible();
  await rokas.getByRole('button', { name: t.confirm, exact: true }).click();
  await expect(rokas).toHaveURL(/\/repertuarai\/[0-9a-f-]{36}$/);
  await expect(rokas.getByRole('heading', { level: 1 })).toHaveText(ITALIAN);
  // The fork's 4.c3 has no comment of its own, only the kept note's mark.
  await chip(rokas, `4. c3, ${r.moves.hasKeptCoachNote}`).click();
  const kept = rokas.getByRole('list', { name: messages.coachNote.list });
  const byCoach = format(messages.coachNote.byCoach, { name: COACH });
  await expect(kept.getByText(byCoach)).toBeVisible();
  await expect(kept.getByText(C3_COMMENT)).toBeVisible();
  // His builder: the move's own comment is empty and his to write; the
  // coach's note stays text beside it.
  await rokas.getByRole('switch', { name: r.mode.build }).click();
  await expect(
    rokas.getByRole('textbox', { name: r.builder.commentLabel, exact: true }),
  ).toHaveValue('');
  await expect(kept.getByText(C3_COMMENT)).toBeVisible();
  await expect(kept.getByRole('textbox')).toHaveCount(0);

  await rokas.goto('/');
  await expect(fromMyCoach(rokas, messages)).toHaveCount(0);
  await rokas.goto(assigned);
  await expectNotAssigned(rokas, cast);
  await coach.reload();
  const row = assignmentRow(coach, messages, ROKAS);
  await expect(badge(row, messages, 'forked')).toBeVisible();
}

for (const locale of ['lt', 'en'] as const) {
  test(`C-M1-3, C-M1-4, C-M1-6 (${locale}): group and individual assignments, a later member's deadline, leaving and rejoining the group`, async ({
    page: coach,
    request,
    browser,
  }) => {
    test.setTimeout(480_000);
    const devices: BrowserContext[] = [];
    const messages = CATALOGUES[locale];
    const cast: Cast = { locale, messages, browser, request, devices };
    try {
      await coachReady(coach, cast);
      await createGroup(coach, messages, GROUP);
      const link = await createInvite(coach, messages, {
        kind: 'group',
        group: GROUP,
      });
      const joins = (name: string): Promise<Page> =>
        playerAccepts(cast, { link, name, group: GROUP });
      const rokas = await joins(ROKAS);
      const gabija = await joins(GABIJA);
      const dovydas = await joins(DOVYDAS);

      const deadline = await assignToGroup(coach, cast, [
        rokas,
        gabija,
        dovydas,
      ]);
      await assignToRokas(coach, cast, { rokas, gabija });
      await laterMember(coach, cast, { link, deadline });
      await leaveAndRejoin(coach, cast, rokas);
    } finally {
      for (const device of devices) await device.close();
    }
  });

  test(`a coach edit shows as Updated once; pause, resume, then make my own copy (${locale})`, async ({
    page: coach,
    request,
    browser,
  }) => {
    test.setTimeout(360_000);
    const devices: BrowserContext[] = [];
    const messages = CATALOGUES[locale];
    const cast: Cast = { locale, messages, browser, request, devices };
    try {
      await coachReady(coach, cast);
      const link = await createInvite(coach, messages, { kind: 'personal' });
      const rokas = await playerAccepts(cast, { link, name: ROKAS });
      await importRepertoire(coach, messages, {
        file: ITALIAN_PGN,
        side: 'white',
        name: ITALIAN,
      });
      await assignTo(coach, messages, { target: ROKAS });
      await rokas.reload();
      const item = homeAssignment(rokas, messages, ITALIAN);
      await expect(badge(item, messages, 'updated')).toHaveCount(0);

      await coachAddsMove(coach, cast);
      await updatedOnce(rokas, cast);
      await pauseAndResume(rokas, coach, cast);
      await makeOwnCopy(rokas, coach, cast);
    } finally {
      for (const device of devices) await device.close();
    }
  });
}
