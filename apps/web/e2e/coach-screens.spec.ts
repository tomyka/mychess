// #381 part 5 (plan Task 17, steps 2 to 4): the coach screens' new
// journeys, docs/personas/coach.md. The dashboard leads with who needs
// attention, Rokas's overdue QGD first as in the persona seed (R-229); on a
// phone the coach note on a shared move is one strip in view, opening the
// "Coach note" sheet; a coach's assigned repertoire leaves his own Today and
// its My repertoires card names its assignees (R-230). Unlink from the
// player page and a group's New link and Revoke are in coaching.spec.ts.
import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { passPlayerDeadline } from './support/assignment-db';
import {
  DOVYDAS,
  GABIJA,
  GROUP,
  ROKAS,
  coachReady,
  linkedPlayer,
  type Cast,
} from './support/assignment-people';
import {
  assignmentRow,
  assignTo,
  fixture,
  importRepertoire,
  openChange,
  vilniusDay,
} from './support/assignments';
import { createGroup, createInvite } from './support/coaching';
import { en, format, test } from './support/journey';
import { ownKeysOf, shareWithCoach } from './support/progress';
import {
  chip,
  openRepertoireOptions,
  openRepertoires,
  plural,
} from './support/repertoires';
import { todayRow } from './support/today';
import {
  CATALAN,
  CATALAN_PGN,
  ITALIAN,
  ITALIAN_PGN,
} from './support/training-cast';

/** Rokas's QGD, overdue in the persona seed (docs/personas/coach.md). */
const QGD = 'Atmestas valdovės gambitas';
const QGD_PGN = fixture('atmestas-valdoves-gambitas.pgn');
/** Gabija's Slav, its deadline near in the persona seed. */
const SLAV = 'Slavų gynyba';
const SLAV_PGN = fixture('slavu-gynyba.pgn');
// The persona lines, proven legal with @mychess/chess: every game imports whole.
ownKeysOf(QGD_PGN, 'black', true);
ownKeysOf(SLAV_PGN, 'black', true);

/** A section of /coach whose name carries its count ("Players · 3"). */
const countedRegion = (page: Page, title: string): Locator =>
  page.getByRole('region', { name: new RegExp(`^${title} · `, 'u') });

/** A new cast for a journey; its devices close when it ends. */
function castOf(
  { browser, request }: Pick<Cast, 'browser' | 'request'>,
  devices: BrowserContext[],
): Cast {
  return { messages: en, browser, request, devices };
}

/**
 * The dashboard's Needs attention, in its order (R-229): Rokas, whose
 * QGD is two days overdue, before Gabija, whose Slav is due in two days at
 * 0% learned, though her name comes first; Dovydas, with nothing assigned,
 * is a player row only. Rokas's card opens his page.
 */
async function needsAttention(coach: Page): Promise<void> {
  const t = en.coach.attention;
  await coach.goto('/coach');
  const section = coach.getByRole('region', {
    name: format(en.coach.sectionCount, { title: t.title, count: '2' }),
    exact: true,
  });
  const cards = section.getByRole('listitem');
  await expect(cards).toHaveCount(2);
  const overdue = plural(format(t.overdue, { name: QGD }), { days: 2 });
  const near = plural(format(t.deadlineNear, { name: SLAV, percent: '0' }), {
    days: 2,
  });
  for (const [index, name, reason] of [
    [0, ROKAS, overdue],
    [1, GABIJA, near],
  ] as const) {
    const card = cards.nth(index);
    await expect(card.getByRole('link', { name, exact: true })).toBeVisible();
    await expect(card.getByText(reason, { exact: true })).toBeVisible();
  }
  await expect(section.getByText(DOVYDAS)).toHaveCount(0);
  await expect(
    countedRegion(coach, en.coach.players.title).getByRole('link', {
      name: DOVYDAS,
      exact: true,
    }),
  ).toBeVisible();
  await cards.first().getByRole('link', { name: ROKAS, exact: true }).click();
  await expect(coach).toHaveURL(/\/coach\/players\/[^/]+$/);
  await expect(coach.getByRole('heading', { level: 1 })).toHaveText(ROKAS);
}

test(
  'R-229: the overdue player is first under Needs attention, with the overdue repertoire in words',
  { tag: '@mobile' },
  async ({ page: coach, request, browser }) => {
    test.setTimeout(300_000);
    const devices: BrowserContext[] = [];
    const cast = castOf({ browser, request }, devices);
    try {
      await coachReady(coach, cast);
      const link = await createGroup(coach, en, GROUP);
      const joins = (name: string) =>
        linkedPlayer(cast, { link, name, group: GROUP });
      const rokas = await joins(ROKAS);
      await joins(GABIJA);
      await joins(DOVYDAS);

      // Set ahead (R-210 refuses a past day), then moved behind: two days
      // overdue, as the seed's 1 November is by now.
      await importRepertoire(coach, en, {
        file: QGD_PGN,
        side: 'black',
        name: QGD,
      });
      await assignTo(coach, en, { target: ROKAS, deadline: vilniusDay(1) });
      await passPlayerDeadline(rokas.email, QGD, vilniusDay(-2));
      await importRepertoire(coach, en, {
        file: SLAV_PGN,
        side: 'black',
        name: SLAV,
      });
      await assignTo(coach, en, { target: GABIJA, deadline: vilniusDay(2) });

      await needsAttention(coach);
    } finally {
      for (const device of devices) await device.close();
    }
  },
);

/** Gabija's 3.Bc4, which carries her comment (fixtures/italiskoji.pgn). */
const BC4 = '3. Bc4';
const BC4_COMMENT = 'Rikis taikosi į f7 langelį.';
const FIRST_NOTE = 'Po 3...Bc5 žaisk c3 ir d4.';
const SECOND_NOTE = 'Po 3...Bc5 žaisk c3, tada d4 su tempu.';

/**
 * On the shared Italian, from 1...e5 three steps forward with the board
 * row to 3.Bc4: its comment and the coach note strip under it are both in
 * the viewport, and the page has not scrolled.
 */
async function stepToBc4(coach: Page): Promise<void> {
  const t = en.repertoires;
  await chip(coach, '1... e5').click();
  const forward = coach.getByRole('button', {
    name: t.nav.forward,
    exact: true,
  });
  for (let i = 0; i < 3; i += 1) await forward.click();
  await expect(
    chip(coach, `${BC4}, ${t.moves.hasComment}`).or(
      chip(coach, `${BC4}, ${t.moves.hasComment}, ${t.moves.hasCoachNote}`),
    ),
  ).toHaveAttribute('aria-current', 'true');
  await expect(coach.getByText(BC4_COMMENT)).toBeInViewport();
}

/** The phone's coach note strip on 3.Bc4: Add a note, or Edit. */
const noteStrip = (coach: Page, saved: boolean): Locator =>
  coach.getByRole('button', {
    name: format(
      saved ? en.coach.shared.editNoteOn : en.coach.shared.addNoteOn,
      {
        move: BC4,
      },
    ),
    exact: true,
  });

/**
 * Taps the strip: the "Coach note" sheet, its field holding `before`;
 * writes `after` and saves. The sheet closes and the strip says "Saved"
 * and shows the note.
 */
async function writeInSheet(
  coach: Page,
  { before, after }: { before: string; after: string },
): Promise<void> {
  const t = en.coach.shared;
  const strip = noteStrip(coach, before !== '');
  await strip.click();
  const sheet = coach.getByRole('dialog', { name: t.noteTitle, exact: true });
  await expect(sheet).toBeVisible();
  const field = sheet.getByRole('textbox');
  await expect(field).toHaveValue(before);
  await field.fill(after);
  await sheet.getByRole('button', { name: t.saveNote, exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(
    coach.getByRole('status').filter({ hasText: t.noteSaved }),
  ).toHaveText(t.noteSaved);
  await expect(noteStrip(coach, true)).toContainText(after);
}

test(
  'R-107 on a phone: the coach note on a shared move is a strip in view that opens the Coach note sheet',
  { tag: '@mobile' },
  async ({ page: coach, request, browser, isMobile }) => {
    test.skip(
      !isMobile,
      'the strip and its sheet are the phone’s; sharing.spec.ts walks the desktop card',
    );
    test.setTimeout(240_000);
    const devices: BrowserContext[] = [];
    const cast = castOf({ browser, request }, devices);
    try {
      await coachReady(coach, cast);
      const link = await createInvite(coach, en);
      const gabija = await linkedPlayer(cast, { link, name: GABIJA });
      await importRepertoire(gabija.page, en, {
        file: ITALIAN_PGN,
        side: 'white',
        name: ITALIAN,
      });
      await shareWithCoach(gabija.page, en);

      await coach.goto('/coach');
      await countedRegion(coach, en.coach.players.title)
        .getByRole('link', { name: GABIJA, exact: true })
        .click();
      await coach
        .getByRole('listitem')
        .filter({
          has: coach.getByRole('heading', {
            level: 3,
            name: ITALIAN,
            exact: true,
          }),
        })
        .getByRole('link', { name: en.coach.progress.openShared, exact: true })
        .click();
      await expect(coach).toHaveURL(/\/repertoires\/[0-9a-f-]{36}$/);
      const scrollY = (): Promise<number> =>
        coach.evaluate(() => window.scrollY);

      // No note yet: the strip offers Add a note.
      await stepToBc4(coach);
      await expect(noteStrip(coach, false)).toBeInViewport({ ratio: 1 });
      expect(await scrollY()).toBe(0);
      await writeInSheet(coach, { before: '', after: FIRST_NOTE });

      // Afresh, on a move with his note: the strip shows it, in view.
      await coach.reload();
      await stepToBc4(coach);
      const strip = noteStrip(coach, true);
      await expect(strip).toBeInViewport({ ratio: 1 });
      await expect(strip).toContainText(FIRST_NOTE);
      expect(await scrollY()).toBe(0);
      await writeInSheet(coach, { before: FIRST_NOTE, after: SECOND_NOTE });
    } finally {
      for (const device of devices) await device.close();
    }
  },
);

/** The My repertoires card of `name`: the link the whole card is. */
const repertoireCard = (page: Page, name: string): Locator =>
  page.getByRole('main').getByRole('link', { name, exact: true });

/** The standing line of an untrained repertoire ("New · 31 moves"). */
const NEW_STANDING = new RegExp(`^${en.standing.new.split('{')[0] ?? ''}`, 'u');

/**
 * R-230 on the coach's own screens: `teaching` is off Today while
 * `own` stays; on My repertoires the teaching card says "Assigned to 1"
 * and no standing of his own, while his own card shows its standing.
 */
async function expectTeaching(
  coach: Page,
  { teaching, own }: { teaching: string; own: string },
): Promise<void> {
  await coach.goto('/');
  await expect(todayRow(coach, en, own)).toBeVisible();
  await expect(todayRow(coach, en, teaching)).toHaveCount(0);
  await openRepertoires(coach, en);
  const card = repertoireCard(coach, teaching);
  await expect(
    card.getByText(format(en.repertoires.list.assignedTo, { count: '1' }), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(card.getByText(NEW_STANDING)).toHaveCount(0);
  await expect(
    repertoireCard(coach, own).getByText(NEW_STANDING),
  ).toBeVisible();
}

test('R-230: the coach’s assigned repertoire leaves his Today, its card names its assignees, and it returns once unassigned', async ({
  page: coach,
  request,
  browser,
}) => {
  test.setTimeout(300_000);
  const devices: BrowserContext[] = [];
  const cast = castOf({ browser, request }, devices);
  try {
    await coachReady(coach, cast);
    const link = await createInvite(coach, en);
    await linkedPlayer(cast, { link, name: ROKAS });
    // His own training, and the Italian he teaches.
    await importRepertoire(coach, en, {
      file: CATALAN_PGN,
      side: 'white',
      name: CATALAN,
    });
    await importRepertoire(coach, en, {
      file: ITALIAN_PGN,
      side: 'white',
      name: ITALIAN,
    });
    await coach.goto('/');
    await expect(todayRow(coach, en, ITALIAN)).toBeVisible();
    await expect(todayRow(coach, en, CATALAN)).toBeVisible();

    await openRepertoires(coach, en);
    await repertoireCard(coach, ITALIAN).click();
    await expect(coach.getByRole('heading', { level: 1 })).toHaveText(ITALIAN);
    await assignTo(coach, en, { target: ROKAS });
    await expectTeaching(coach, { teaching: ITALIAN, own: CATALAN });

    // Unassigned from everyone, it is his to train again.
    await openRepertoires(coach, en);
    await repertoireCard(coach, ITALIAN).click();
    await expect(coach.getByRole('heading', { level: 1 })).toHaveText(ITALIAN);
    await openRepertoireOptions(coach, en);
    const t = en.assignment.panel;
    const row = assignmentRow(coach, en, ROKAS);
    await openChange(row, en);
    await row.getByRole('button', { name: t.unassign, exact: true }).click();
    await row
      .getByRole('button', { name: t.unassignConfirm, exact: true })
      .click();
    await expect(row).toHaveCount(0);
    await coach.goto('/');
    await expect(todayRow(coach, en, ITALIAN)).toBeVisible();
  } finally {
    for (const device of devices) await device.close();
  }
});
