// #323: the training screen fits every width from a phone to a desktop
// (R-7, mobile-first), and a card opens with the move field in view. The
// card asked is the deepest move of the backlog's first line, so the line
// so far is long enough to overflow the desktop panel.
import { expect, type Page } from '@playwright/test';
import { en, newOnboardedAccount, test } from './support/journey';
import { importRepertoire } from './support/assignments';
import { seedDue } from './support/training-db';
import { expectCounter, keyAfter } from './support/training';
import { BACKLOG, BACKLOG_PGN, backlog } from './support/training-cast';

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

/** Below `lg` (1024px) the move field waits behind the Type button. */
const isCompact = (width: number): boolean => width < 1024;

/**
 * Where the board, the move entry (the field, or Type on a compact width)
 * and its scrolling panel are, and the page's width.
 */
async function measure(
  page: Page,
  compact: boolean,
): Promise<{
  readonly pageWidth: number;
  readonly board: Box;
  readonly entry: Box;
  readonly panel: Box;
}> {
  return page.evaluate(
    ({ label, typeLabel, compact: phone }) => {
      const boxOf = (element: Element | null | undefined): Box => {
        if (element === null || element === undefined)
          throw new Error('element not found');
        const { left, right, top, bottom } = element.getBoundingClientRect();
        return { left, right, top, bottom };
      };
      const entry = phone
        ? [...document.querySelectorAll('button')].find(
            (b) => b.textContent.trim() === typeLabel,
          )
        : document.querySelector(`input[placeholder="${label}"]`);
      let panel = entry?.parentElement;
      while (
        panel !== null &&
        panel !== undefined &&
        getComputedStyle(panel).overflowY !== 'auto'
      )
        panel = panel.parentElement;
      return {
        pageWidth: document.documentElement.scrollWidth,
        board: boxOf(document.querySelector('cg-board')),
        entry: boxOf(entry),
        panel: boxOf(panel),
      };
    },
    {
      label: en.board.moveInput.label,
      typeLabel: en.training.drill.type,
      compact,
    },
  );
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
    await page.goto('/training?mode=review');
    await expectCounter(page, 0, 1);
    const compact = isCompact(viewport.width);
    await expect(
      compact
        ? page.getByRole('button', {
            name: en.training.drill.type,
            exact: true,
          })
        : page.getByLabel(en.board.moveInput.label, { exact: true }),
    ).toBeVisible();
    await expect(page.locator('cg-board')).toBeVisible();
    const at = `${String(viewport.width)}x${String(viewport.height)}`;
    const { pageWidth, board, entry, panel } = await measure(page, compact);
    expect(pageWidth, at).toBeLessThanOrEqual(viewport.width);
    expect(board.left, at).toBeGreaterThanOrEqual(0);
    expect(board.right, at).toBeLessThanOrEqual(viewport.width);
    expect(entry.top, at).toBeGreaterThanOrEqual(panel.top);
    expect(entry.bottom, at).toBeLessThanOrEqual(panel.bottom);
    expect(entry.bottom, at).toBeLessThanOrEqual(viewport.height);
  }
});
