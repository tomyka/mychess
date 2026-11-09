// #323: the training screen fits every width from a phone to a desktop
// (R-7, mobile-first), and a card opens with the move field in view. The
// card asked is the deepest move of the backlog's first line, so the line
// so far is long enough to overflow the desktop panel.
import { expect, type Page } from '@playwright/test';
import { CATALOGUES, newOnboardedAccount, test } from './support/journey';
import { importRepertoire } from './support/assignments';
import { seedDue } from './support/training-db';
import { expectCounter, keyAfter } from './support/training';
import { BACKLOG, BACKLOG_PGN, backlog } from './support/training-cast';

// The UI is served in English only for now (R-180).
const { en } = CATALOGUES;

/** The backlog's first line up to its last White move, 16. Ra3. */
const LINE_ONE =
  'd4 Nf6 Kd2 c5 Nh3 d5 f4 Bg4 b3 Be6 a4 Nfd7 Ng5 Nb6 Bb2 Rg8 Nh3 Na6 b4 g5 Qe1 cxd4 Rg1 g4 e3 Nc4+ Kd3 Qb8 Qc1 Bg7'.split(
    ' ',
  );
const DEEPEST = keyAfter(backlog, LINE_ONE, 'Ra3');

/** Phone, phone, tablet portrait, iPad portrait and landscape, laptop, desktop. */
const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 1366 },
  { width: 1366, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
] as const;

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Where the board, the move field and its scrolling panel are, and the page's width. */
async function measure(page: Page): Promise<{
  readonly pageWidth: number;
  readonly board: Box;
  readonly field: Box;
  readonly panel: Box;
}> {
  return page.evaluate((label) => {
    const boxOf = (element: Element | null | undefined): Box => {
      if (element === null || element === undefined)
        throw new Error('element not found');
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    const field = document.querySelector(`input[placeholder="${label}"]`);
    let panel = field?.parentElement;
    while (
      panel !== null &&
      panel !== undefined &&
      getComputedStyle(panel).overflowY !== 'auto'
    )
      panel = panel.parentElement;
    return {
      pageWidth: document.documentElement.scrollWidth,
      board: boxOf(document.querySelector('cg-board')),
      field: boxOf(field),
      panel: boxOf(panel),
    };
  }, en.board.moveInput.label);
}

test('#323: the training screen fits from a phone to a desktop, the move field in view', async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(isMobile, 'the viewports are set one by one');
  test.setTimeout(120_000);
  const email = await newOnboardedAccount(page, request, 'Dovydas Jankauskas');
  await importRepertoire(page, en, {
    file: BACKLOG_PGN,
    side: 'white',
    name: BACKLOG,
  });
  await seedDue(email, [DEEPEST]);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    // Each width opens the card afresh, as a player would.
    await page.goto('/treniruote?mode=review');
    await expectCounter(page, 0, 1);
    await expect(
      page.getByLabel(en.board.moveInput.label, { exact: true }),
    ).toBeVisible();
    await expect(page.locator('cg-board')).toBeVisible();
    const at = `${String(viewport.width)}x${String(viewport.height)}`;
    const { pageWidth, board, field, panel } = await measure(page);
    expect(pageWidth, at).toBeLessThanOrEqual(viewport.width);
    expect(board.left, at).toBeGreaterThanOrEqual(0);
    expect(board.right, at).toBeLessThanOrEqual(viewport.width);
    expect(field.top, at).toBeGreaterThanOrEqual(panel.top);
    expect(field.bottom, at).toBeLessThanOrEqual(panel.bottom);
    expect(field.bottom, at).toBeLessThanOrEqual(viewport.height);
  }
});
