// S3 journeys (plan Task 21): U1-M1-5 (own part), G-M1-2, G-M1-6, adding
// to an existing repertoire (R-101, R-115, R-117), the keyboard, and
// another account's repertoire. Adapted to what was built: the first move
// makes the first chapter (R-111), an empty note is one "My note" button
// and a one-chapter list starts closed (R-116), the edit mode is "Edit"
// (R-118).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { playOnBoard, type BoardHand } from './support/board';
import {
  CATALOGUES,
  format,
  newDevice,
  newOnboardedAccount,
  test,
  type Messages,
} from './support/journey';
import {
  arrowText,
  chip,
  chooseChapter,
  createRepertoire,
  disclosure,
  expectSummary,
  openRepertoires,
  plural,
  previewImport,
  typeMove,
} from './support/repertoires';

const { lt, en } = CATALOGUES;

const fixture = (name: string): string =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

/** Gabija's six Taimanov lines and a seventh game with an illegal move. */
const TAIMANOV = fixture('taimanov.pgn');
/** Two new lines for the Taimanov and one it already has (R-117). */
const TAIMANOV_MORE = fixture('taimanov-more.pgn');
/** A second answer and a line the Taimanov already has: nothing to add (R-115). */
const TAIMANOV_NOTHING = fixture('taimanov-nothing.pgn');

/** The Taimanov import's counts, proven with `importPgn` and `summarize`. */
const TAIMANOV_COUNTS = {
  chapters: 6,
  lines: 8,
  positions: 107,
  transpositions: 1,
  moves: 107,
};

const TAIMANOV_B48 = 'Siciliška gynyba, Taimanovo variantas';
const TAIMANOV_B47 = 'Siciliška gynyba, Taimanovo (Bastrikovo) variantas';

/** The Taimanov's intro, comments and arrow show on their moves. */
async function expectTaimanovNotes(page: Page): Promise<void> {
  const t = lt.repertoires;
  await chooseChapter(page, TAIMANOV_B48);
  await expect(
    page.getByText(
      'Taimanovo variantas: juodieji stato Qc7 ir a6, o žirgą laiko c6.',
    ),
  ).toBeVisible();
  await chip(page, `9... Ne5, ${t.moves.hasComment}`).click();
  await expect(page.getByText('Juodieji spaudžia c4 langelį.')).toBeVisible();
  // 6.Be2 is the first of the two Bastrikov (B47) chapters.
  await chooseChapter(page, TAIMANOV_B47);
  await chip(page, `8... Bb4, ${t.moves.hasComment}`).click();
  await expect(page.getByText('jei 9.Na4, tai Be7')).toBeVisible();
  await chip(page, '9... Be7').click();
  await expect(
    page.getByText(arrowText(lt, { from: 'b4', to: 'e7' })),
  ).toBeAttached();
}

/** Imports `file` as a new Black repertoire `name`; returns its page URL. */
async function importAsNew(
  page: Page,
  file: string,
  name: string,
): Promise<string> {
  const t = lt.repertoires.import;
  await page.goto('/repertuarai/importuoti');
  await previewImport(page, lt, { file, side: 'black' });
  await expectSummary(page, lt, 'lt', TAIMANOV_COUNTS);
  await expect(page.getByRole('radio', { name: t.targetNew })).toBeChecked();
  await page.getByLabel(t.name, { exact: true }).fill(name);
  await page.getByRole('button', { name: t.confirm, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  return page.url();
}

/** In Lithuanian settings, switches the account to English, then home. */
async function chooseEnglish(page: Page): Promise<void> {
  await page.getByRole('link', { name: lt.app.settings }).click();
  await page.getByRole('radio', { name: en.language.en }).check();
  await page.getByRole('button', { name: lt.settings.profile.submit }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('link', { name: en.settings.home }).click();
}

// Rokas's two London lines after 1.d4 d5 2.Bf4 and after 1.d4
// (docs/personas/u1400.md), typed move by move.
const LONDON_D5 = [
  ...['Nf6', 'e3', 'e6', 'Nf3', 'c5', 'c3'],
  ...['Nc6', 'Nbd2', 'Bd6', 'Bg3', 'O-O', 'Bd3'],
];
const LONDON_KID = [
  ...['Nf6', 'Bf4', 'g6', 'e3', 'Bg7', 'Nf3', 'O-O'],
  ...['Be2', 'd6', 'h3', 'c5', 'c3', 'Nc6', 'O-O'],
];

/** On 2.Bf4 in the builder: the comment, then a green arrow in draw mode. */
async function commentAndArrow(
  hand: BoardHand,
  messages: Messages,
  comment: string,
): Promise<void> {
  const { page } = hand;
  const t = messages.repertoires;
  await page
    .getByRole('textbox', { name: t.builder.commentLabel, exact: true })
    .fill(comment);
  await page.getByRole('button', { name: t.builder.commentSave }).click();
  await expect(page.getByText(t.builder.commentSaved)).toBeVisible();
  await page.getByRole('button', { name: t.builder.draw }).click();
  await page.getByRole('button', { name: t.colors.G }).click();
  await playOnBoard(hand, 'c1', 'f4');
  await expect(
    page.getByText(arrowText(messages, { from: 'c1', to: 'f4' })),
  ).toBeAttached();
  await page.getByRole('button', { name: t.builder.drawDone }).click();
}

/** Builds both London lines: the first moves on the board, the rest typed. */
async function buildLondon(
  hand: BoardHand,
  messages: Messages,
  comment: string,
): Promise<void> {
  const { page } = hand;
  const t = messages.repertoires;
  await expect(page.getByText(t.builder.playFirst)).toBeVisible();
  // R-111: the first move played makes the first chapter, in one step.
  await playOnBoard(hand, 'd2', 'd4');
  await expect(chip(page, '1. d4')).toBeVisible();
  await expect(disclosure(page)).toContainText(
    format(t.chapters.position, { index: '1', count: '1' }),
  );
  await playOnBoard(hand, 'd7', 'd5');
  await expect(chip(page, '1... d5')).toBeVisible();
  await playOnBoard(hand, 'c1', 'f4');
  await expect(chip(page, '2. Bf4')).toHaveAttribute('aria-current', 'true');
  await commentAndArrow(hand, messages, comment);
  for (const san of LONDON_D5) await typeMove(page, messages, san);
  // Back to 1.d4, then the King's Indian line.
  await chip(page, '1. d4').click();
  for (const san of LONDON_KID) await typeMove(page, messages, san);
}

/** After a reload: both lines, the comment, the arrow; a note is added. */
async function checkLondon(
  page: Page,
  messages: Messages,
  comment: string,
): Promise<void> {
  const t = messages.repertoires;
  await page.reload();
  await expect(chip(page, '8. Bd3')).toBeVisible();
  await expect(chip(page, '8. O-O')).toBeVisible();
  // R-116: one chapter, so its list starts closed.
  await expect(disclosure(page)).toHaveAttribute('aria-expanded', 'false');
  await chip(page, `2. Bf4, ${t.moves.hasComment}`).click();
  await expect(page.getByText(comment)).toBeVisible();
  await expect(
    page.getByText(arrowText(messages, { from: 'c1', to: 'f4' })),
  ).toBeAttached();
  // R-116: an empty note is one "My note" button that opens the field.
  await page.getByRole('button', { name: t.note.label }).click();
  const note = page.getByRole('textbox', { name: t.note.label, exact: true });
  await expect(note).toBeFocused();
  await note.fill('Bf4 anksti.');
  await page.getByRole('button', { name: t.note.save }).click();
  await expect(page.getByText(t.note.saved)).toBeVisible();
}

for (const locale of ['lt', 'en'] as const) {
  test(`U1-M1-5 (own part, ${locale}): Rokas builds the London on the board, with a comment and an arrow`, async ({
    page,
    request,
    isMobile,
  }) => {
    test.setTimeout(180_000);
    const messages = CATALOGUES[locale];
    await newOnboardedAccount(page, request, 'Rokas Petrauskas');
    if (locale === 'en') await chooseEnglish(page);
    await openRepertoires(page, messages);
    const name = locale === 'lt' ? 'Londono sistema' : 'London System';
    await createRepertoire(page, messages, { name, side: 'white' });
    const comment =
      locale === 'lt' ? 'Rikis išeina prieš e3.' : 'The bishop goes out first.';
    await buildLondon({ page, isMobile }, messages, comment);
    await checkLondon(page, messages, comment);
    const t = messages.repertoires;
    await page.getByRole('link', { name: t.header.back }).first().click();
    await expect(page).toHaveURL(/\/repertuarai$/);
    await expect(
      page.getByText(plural(t.list.meta, locale, { chapters: 1, moves: 29 })),
    ).toBeVisible();
  });
}

test('G-M1-2, G-M1-6: Gabija imports the Taimanov, and its PGN download re-imports to the same tree', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const t = lt.repertoires;
  await newOnboardedAccount(page, request, 'Gabija Navickaitė');
  await openRepertoires(page, lt);
  await page.getByRole('link', { name: t.list.import }).click();
  await previewImport(page, lt, { file: TAIMANOV, side: 'black' });
  await expectSummary(page, lt, 'lt', TAIMANOV_COUNTS);
  // R-64: the broken game is listed with its number and reason.
  await expect(
    page.getByRole('heading', {
      name: format(t.import.skippedTitle, { count: '1' }),
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      format(t.import.skippedMove, {
        game: '7',
        reason: lt.pgn.illegalMove,
        move: 'Bxh7',
      }),
    ),
  ).toBeVisible();
  await page.getByLabel(t.import.name, { exact: true }).fill('Taimanovas');
  await page
    .getByRole('button', { name: t.import.confirm, exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Taimanovas',
  );
  await expect(disclosure(page)).toContainText(
    format(t.chapters.position, { index: '1', count: '6' }),
  );
  await expectTaimanovNotes(page);

  // G-M1-6: the download re-imports to the same tree, comments included.
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: t.header.download }).first().click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.pgn$/);
  const path = await download.path();
  expect(await readFile(path, 'utf8')).toContain('jei 9.Na4, tai Be7');
  await importAsNew(page, path, 'Taimanovas (kopija)');
  await expectTaimanovNotes(page);
});

test('R-101, R-115, R-117: a PGN is added to an existing repertoire only where it adds a move', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const t = lt.repertoires;
  await newOnboardedAccount(page, request, 'Gabija Navickaitė');
  const url = await importAsNew(page, TAIMANOV, 'Taimanovas');

  // Nothing to add: refused, and the repertoire is not touched (R-115).
  await page.getByRole('link', { name: t.header.importInto }).first().click();
  await previewImport(page, lt, { file: TAIMANOV_NOTHING });
  await expect(page.getByText(lt.pgn.nothingToAdd)).toBeVisible();
  await expect(
    page.getByRole('button', { name: t.import.confirm, exact: true }),
  ).toBeDisabled();

  // Two new lines and one it has: two chapters after the six (R-117).
  await page.goto(url);
  await page.getByRole('link', { name: t.header.importInto }).first().click();
  await previewImport(page, lt, { file: TAIMANOV_MORE });
  await expect(
    page.getByText(
      plural(t.import.added, 'lt', {
        chapters: 2,
        moves: 12,
        name: 'Taimanovas',
      }),
    ),
  ).toBeVisible();
  await page
    .getByRole('button', { name: t.import.confirm, exact: true })
    .click();
  // The repertoire opens on the first chapter the import added.
  await expect(disclosure(page)).toContainText(
    format(t.chapters.position, { index: '7', count: '8' }),
  );
  await page.getByRole('link', { name: t.header.back }).first().click();
  await expect(
    page.getByText(plural(t.list.meta, 'lt', { chapters: 8, moves: 119 })),
  ).toBeVisible();
});

test('the board takes a move from the keyboard in builder mode', async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(isMobile, 'a phone has no arrow keys');
  await newOnboardedAccount(page, request, 'Rokas Petrauskas');
  await openRepertoires(page, lt);
  await createRepertoire(page, lt, { name: 'Klaviatūra', side: 'white' });
  // Tab from the mode switch lands on the board: one tab stop.
  await page.getByRole('switch', { name: lt.repertoires.mode.build }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('application')).toBeFocused();
  // The cursor starts on a1: to d2, pick up; to d4, drop.
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowUp'])
    await page.keyboard.press(key);
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(chip(page, '1. d4')).toHaveAttribute('aria-current', 'true');
  await page.reload();
  await expect(chip(page, '1. d4')).toBeVisible();
});

test('another account’s repertoire and its download are not found', async ({
  page,
  request,
  browser,
}) => {
  await newOnboardedAccount(page, request, 'Rokas Petrauskas');
  await openRepertoires(page, lt);
  await createRepertoire(page, lt, { name: 'Londono sistema', side: 'white' });
  const id = /\/repertuarai\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (id === undefined) throw new Error('no repertoire id in the URL');

  const other = await newDevice(browser);
  try {
    const stranger = await other.newPage();
    await newOnboardedAccount(stranger, request, 'Dovydas');
    // The page streams (loading.tsx), so its status is whatever streaming
    // gives; what the stranger sees is what is checked.
    await stranger.goto(`/repertuarai/${id}`);
    await expect(stranger.getByText(lt.repertoire.notFound)).toBeVisible();
    await expect(stranger.getByText('Londono sistema')).toHaveCount(0);
    const exported = await other.request.get(`/api/repertoires/${id}/export`);
    expect(exported.status()).toBe(404);
  } finally {
    await other.close();
  }
});
