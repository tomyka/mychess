// S7 journey C-M1-5 (docs/personas/coach.md; plan Task E1): the coach
// opens his group's progress, and each player's state matches the Review
// history seeded for them (support/progress-db). Gabija learned the whole
// Caro-Kann, Rokas has 2 moves due and 1 marked "I know this", Dovydas
// has not started it. The players list and the grid say when each last
// trained (R-154); the grid opens Rokas's progress page, whose chapters
// open to their lines (R-152). Rokas's private London is named nowhere and
// its progress URL is not found (R-39); Dovydas's own copy of the Italian
// shows its badge only (R-155); Gabija's shared Taimanov links from its own
// page to her progress on it.
import { ecoName } from '@mychess/chess';
import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  DOVYDAS,
  GABIJA,
  GROUP,
  ROKAS,
  coachReady,
  linkedPlayer,
  type Cast,
  type Player,
} from './support/assignment-people';
import {
  assignTo,
  badge,
  fixture,
  importRepertoire,
} from './support/assignments';
import { createGroup, createInvite } from './support/coaching';
import { CATALOGUES, format, test } from './support/journey';
import {
  countsText,
  idIn,
  makeOwnCopy,
  notStarted,
  ownKeysOf,
  percentText,
  progressPath,
  shareWithCoach,
  type Counts,
} from './support/progress';
import { seedHistory, seedResult } from './support/progress-db';
import { plural } from './support/repertoires';

const KARO_KAN = 'Karo-Kan gynyba: pagrindai';
const ITALIAN = 'Itališkoji partija';
const LONDON = 'Londono sistema';
const TAIMANOV = 'Taimanovas';

/** The coach's five Caro-Kann lines (docs/personas/coach.md), Black. */
const KARO_KAN_PGN = fixture('karo-kan.pgn');
/** The eight Italian lines (docs/personas/u1400.md), White. */
const ITALIAN_PGN = fixture('italiskoji.pgn');
/** Rokas's private London, his two lines of docs/personas/u1400.md. */
const LONDON_PGN = fixture('londono.pgn');
/** Gabija's Taimanov (with one broken game the import skips). */
const TAIMANOV_PGN = fixture('taimanov.pgn');

const KARO_KAN_KEYS = ownKeysOf(KARO_KAN_PGN, 'black', true);
const TAIMANOV_KEYS = ownKeysOf(TAIMANOV_PGN, 'black', false);
// Proven legal here, though only the browser imports them.
ownKeysOf(LONDON_PGN, 'white', true);
ownKeysOf(ITALIAN_PGN, 'white', true);

/** Rokas: his first two Caro-Kann moves due, the third "I know this". */
const ROKAS_DUE = KARO_KAN_KEYS.slice(0, 2);
const ROKAS_SKIPPED = KARO_KAN_KEYS.slice(2, 3);
/**
 * The own moves of the first line (the Advance variation): 1...c6 2...d5
 * 3...Bf5 4...e6 5...c5 6...Nd7 7...Ne7 8...dxc4 9...Nd5 10...Nxe3
 * 11...Be4. Rokas's three seeded moves are its first three.
 */
const FIRST_LINE_MOVES = 11;

/**
 * The titles of the Caro-Kann's chapters 1 (B12) and 5 (B11). Lithuanian
 * names both openings the same, so each shows its ECO code and the first
 * move it parts from the others at (R-158); English names them apart.
 */
const KARO_KAN_TITLES = {
  lt: [
    'Karo-Kano gynyba (B12, 3.\u00A0e5)',
    'Karo-Kano gynyba (B11, 2.\u00A0Nc3)',
  ],
  en: [ecoName('B12', 'en'), ecoName('B11', 'en')],
} as const;

/** Each player's Caro-Kann counts, as seeded. */
const SEEDED = {
  [GABIJA]: { ...notStarted(0), learned: KARO_KAN_KEYS.length },
  [ROKAS]: {
    ...notStarted(KARO_KAN_KEYS.length - 3),
    due: ROKAS_DUE.length,
    skipped: ROKAS_SKIPPED.length,
  },
  [DOVYDAS]: notStarted(KARO_KAN_KEYS.length),
} as const satisfies Record<string, Counts>;

type Seeded = keyof typeof SEEDED;

/** "Last trained today" for Gabija and Rokas; Dovydas has not (R-154). */
function lastTrained(cast: Cast, name: Seeded): string {
  const t = cast.messages.coach.progress;
  return name === DOVYDAS ? t.neverTrained : t.today;
}

/** The private repertoire's name is not on the page nor in what it was sent. */
async function expectNoPrivateName(page: Page): Promise<void> {
  await expect(page.getByText(LONDON)).toHaveCount(0);
  expect(await page.content()).not.toContain(LONDON);
}

/** The players list on /treneris: each player's "last trained". */
async function playersList(coach: Page, cast: Cast): Promise<void> {
  const t = cast.messages.coach.players;
  await coach.goto('/treneris');
  const list = coach.getByRole('region', { name: t.title, exact: true });
  for (const name of [GABIJA, ROKAS, DOVYDAS] as const) {
    const row = list.getByRole('listitem').filter({
      has: coach.getByRole('link', { name, exact: true }),
    });
    await expect(
      row.getByText(lastTrained(cast, name), { exact: true }),
    ).toBeVisible();
  }
  await expectNoPrivateName(coach);
}

/** A grid cell's link name: the player, the repertoire, % and due (WCAG 2.5.3). */
function cellName(cast: Cast, name: Seeded): string {
  const { locale } = cast;
  const t = cast.messages.coach.progress;
  const counts = SEEDED[name];
  return format(t.cellLabel, {
    name,
    repertoire: KARO_KAN,
    percent: percentText(locale, counts),
    due: plural(t.cellDue, locale, { due: counts.due }),
  });
}

/**
 * The group page's grid (R-153): a row per player with "last trained", the
 * Caro-Kann column, each cell % learned and the due count as seeded, and
 * Gabija's Mastered. Opens Rokas's cell.
 */
async function groupGrid(coach: Page, cast: Cast): Promise<void> {
  const t = cast.messages.coach.progress;
  await coach.getByRole('link', { name: GROUP, exact: true }).click();
  await expect(coach).toHaveURL(/\/treneris\/grupes\//);
  const grid = coach.getByRole('region', { name: t.gridTitle, exact: true });
  await expect(
    grid.getByRole('columnheader', { name: KARO_KAN, exact: true }),
  ).toBeVisible();
  for (const name of [GABIJA, ROKAS, DOVYDAS] as const) {
    const row = grid.getByRole('row').filter({
      has: coach.getByRole('link', { name, exact: true }),
    });
    await expect(
      row.getByText(lastTrained(cast, name), { exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole('link', { name: cellName(cast, name), exact: true }),
    ).toBeVisible();
    await expect(row.getByText(t.mastered, { exact: true })).toHaveCount(
      name === GABIJA ? 1 : 0,
    );
  }
  await expectNoPrivateName(coach);
  await grid
    .getByRole('link', { name: cellName(cast, ROKAS), exact: true })
    .click();
  await expect(coach).toHaveURL(/\/pazanga\/[0-9a-f-]{36}$/);
}

/** The progress page's header: the repertoire, the player, the whole bar. */
const pageHeader = (page: Page): Locator =>
  page.getByRole('main').locator('header').first();

/**
 * Rokas's progress page (R-152): the whole repertoire's counts as seeded;
 * the first chapter opens to its lines, the first holding his three seeded
 * moves. Back to his player page by the header's link.
 */
async function rokasProgress(coach: Page, cast: Cast): Promise<void> {
  const { locale } = cast;
  const t = cast.messages.coach.progress;
  await expect(coach.getByRole('heading', { level: 1 })).toHaveText(KARO_KAN);
  const header = pageHeader(coach);
  await expect(
    header.getByText(countsText(locale, SEEDED[ROKAS]), { exact: true }),
  ).toBeVisible();
  // The Advance variation is the first chapter and has the one line.
  const counts = countsText(locale, {
    ...SEEDED[ROKAS],
    notStarted: FIRST_LINE_MOVES - 3,
  });
  const chapters = coach.getByRole('region', { name: t.chapters, exact: true });
  const [advance, twoKnights] = KARO_KAN_TITLES[locale];
  const titleOf = (index: number): Locator =>
    chapters.locator('details').nth(index).locator('summary');
  await expect(titleOf(0).getByText(advance, { exact: true })).toBeVisible();
  await expect(titleOf(4).getByText(twoKnights, { exact: true })).toBeVisible();
  const first = chapters.locator('details').first();
  await expect(first).not.toHaveAttribute('open');
  const summary = first.locator('summary');
  await expect(summary.getByText(counts, { exact: true })).toBeVisible();
  await summary.click();
  await expect(first).toHaveAttribute('open');
  const lines = first
    .getByRole('list', { name: t.lines, exact: true })
    .getByRole('listitem');
  await expect(lines).toHaveCount(1);
  await expect(lines).toContainText(/^1\. e4 c6 2\. d4 d5 3\. e5 Bf5/);
  await expect(lines.getByText(counts, { exact: true })).toBeVisible();
  await expectNoPrivateName(coach);
  await header.getByRole('link', { name: ROKAS, exact: true }).click();
  await expect(coach).toHaveURL(/\/treneris\/zaidejai\/[^/]+$/);
}

/** The player page's progress section (R-151 to R-155). */
const progressSection = (coach: Page, cast: Cast): Locator =>
  coach.getByRole('region', {
    name: cast.messages.coach.progress.title,
    exact: true,
  });

/** One row of the progress section, by its repertoire's name. */
const progressRow = (coach: Page, cast: Cast, name: string): Locator =>
  progressSection(coach, cast).getByRole('listitem').filter({ hasText: name });

/**
 * Rokas's player page: the Caro-Kann as assigned with his counts, and his
 * private London nowhere (R-39); its progress URL is not found.
 */
async function rokasPage(
  coach: Page,
  cast: Cast,
  londonId: string,
): Promise<void> {
  const { locale } = cast;
  const t = cast.messages.coach.progress;
  const section = progressSection(coach, cast);
  await expect(section.getByText(t.today, { exact: true })).toBeVisible();
  const row = progressRow(coach, cast, KARO_KAN);
  await expect(row.getByRole('link', { name: KARO_KAN })).toBeVisible();
  const percent = percentText(locale, SEEDED[ROKAS]);
  await expect(
    row.getByText(`${t.assigned} · ${percent}`, { exact: true }),
  ).toBeVisible();
  await expect(
    row.getByText(countsText(locale, SEEDED[ROKAS]), { exact: true }),
  ).toBeVisible();
  await expect(section.getByRole('listitem')).toHaveCount(1);
  await expectNoPrivateName(coach);

  const response = await coach.goto(progressPath(idIn(coach.url()), londonId));
  expect(response?.status()).toBe(404);
  await expectNoPrivateName(coach);
}

/**
 * Dovydas's player page: the Italian he made his own copy of shows its
 * badge and no progress or link (R-155); its progress URL is not found.
 * His training on the copy does not count as trained (R-154).
 */
async function dovydasPage(
  coach: Page,
  cast: Cast,
  italianId: string,
): Promise<void> {
  const { messages } = cast;
  const t = messages.coach.progress;
  await coach.goto('/treneris');
  await coach.getByRole('link', { name: DOVYDAS, exact: true }).click();
  const section = progressSection(coach, cast);
  await expect(
    section.getByText(t.neverTrained, { exact: true }),
  ).toBeVisible();
  const row = progressRow(coach, cast, ITALIAN);
  await expect(badge(row, messages, 'forked')).toBeVisible();
  await expect(row.getByText(t.forkedNote, { exact: true })).toBeVisible();
  await expect(row.getByRole('link')).toHaveCount(0);
  await expect(row.getByText(t.assigned, { exact: true })).toBeVisible();

  const response = await coach.goto(progressPath(idIn(coach.url()), italianId));
  expect(response?.status()).toBe(404);
}

/**
 * Gabija's player page: the Caro-Kann learned and Mastered, the Taimanov
 * she shares not started; from the shared Taimanov's own page, the link to
 * her progress on it.
 */
async function gabijaPage(coach: Page, cast: Cast): Promise<void> {
  const { locale, messages } = cast;
  const t = messages.coach.progress;
  await coach.goto('/treneris');
  await coach.getByRole('link', { name: GABIJA, exact: true }).click();
  const caroKann = progressRow(coach, cast, KARO_KAN);
  await expect(
    caroKann.getByText(countsText(locale, SEEDED[GABIJA]), { exact: true }),
  ).toBeVisible();
  await expect(caroKann.getByText(t.mastered, { exact: true })).toBeVisible();
  const taimanov = notStarted(TAIMANOV_KEYS.length);
  await expect(
    progressRow(coach, cast, TAIMANOV).getByText(
      `${t.shared} · ${percentText(locale, taimanov)}`,
      { exact: true },
    ),
  ).toBeVisible();

  await coach
    .getByRole('region', { name: messages.coach.shared.title, exact: true })
    .getByRole('link', { name: new RegExp(`^${TAIMANOV}`) })
    .click();
  await expect(coach).toHaveURL(/\/repertuarai\/[0-9a-f-]{36}$/);
  await expect(coach.getByRole('heading', { level: 1 })).toHaveText(TAIMANOV);
  await coach.getByRole('link', { name: t.title, exact: true }).click();
  await expect(coach).toHaveURL(/\/pazanga\/[0-9a-f-]{36}$/);
  await expect(coach.getByRole('heading', { level: 1 })).toHaveText(TAIMANOV);
  await expect(
    pageHeader(coach).getByText(countsText(locale, taimanov), { exact: true }),
  ).toBeVisible();
}

/** The ids the journey needs after setting up. */
interface Setup {
  readonly karoKanId: string;
  readonly italianId: string;
  readonly londonId: string;
  readonly forkId: string;
}

/**
 * The coach's Caro-Kann to the group and Italian to Dovydas, who makes his
 * own copy; Rokas's private London; Gabija's Taimanov shared with the coach.
 */
async function repertoires(
  coach: Page,
  cast: Cast,
  { rokas, gabija, dovydas }: Record<'rokas' | 'gabija' | 'dovydas', Player>,
): Promise<Setup> {
  const { messages } = cast;
  const imported = async (
    page: Page,
    file: string,
    side: 'white' | 'black',
    name: string,
  ): Promise<string> =>
    idIn(await importRepertoire(page, messages, { file, side, name }));
  const karoKanId = await imported(coach, KARO_KAN_PGN, 'black', KARO_KAN);
  await assignTo(coach, messages, { target: GROUP });
  const italianId = await imported(coach, ITALIAN_PGN, 'white', ITALIAN);
  await assignTo(coach, messages, { target: DOVYDAS });
  const forkId = await makeOwnCopy(dovydas.page, messages, ITALIAN);
  const londonId = await imported(rokas.page, LONDON_PGN, 'white', LONDON);
  await imported(gabija.page, TAIMANOV_PGN, 'black', TAIMANOV);
  await shareWithCoach(gabija.page, messages, cast.locale);
  return { karoKanId, italianId, londonId, forkId };
}

for (const locale of ['lt', 'en'] as const) {
  test(`C-M1-5 (${locale}): the coach sees each player's progress as seeded, and never Rokas's private repertoire`, async ({
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
      const joins = (name: string): Promise<Player> =>
        linkedPlayer(cast, { link, name, group: GROUP });
      const players = {
        rokas: await joins(ROKAS),
        gabija: await joins(GABIJA),
        dovydas: await joins(DOVYDAS),
      };
      const ids = await repertoires(coach, cast, players);

      // Gabija learned it all, Rokas 2 due and 1 "I know this"; Dovydas
      // trained only his own copy, whose results the coach does not count.
      await seedHistory(players.gabija.email, ids.karoKanId, {
        learned: KARO_KAN_KEYS,
      });
      await seedHistory(players.rokas.email, ids.karoKanId, {
        due: ROKAS_DUE,
        skipped: ROKAS_SKIPPED,
      });
      await seedResult(players.dovydas.email, ids.forkId, 'seed');

      await playersList(coach, cast);
      await groupGrid(coach, cast);
      await rokasProgress(coach, cast);
      await rokasPage(coach, cast, ids.londonId);
      await dovydasPage(coach, cast, ids.italianId);
      await gabijaPage(coach, cast);
    } finally {
      for (const device of devices) await device.close();
    }
  });
}
