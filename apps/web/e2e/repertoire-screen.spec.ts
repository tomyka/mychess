// #381 (plan Task 14, steps 3 and 4): the repertoire page's layout as a
// player meets it. The chapter line starts closed at every width; on a
// phone the comment strip stays pinned while the board row steps; "I know
// this" lives in Train here under the move list (R-227, R-147); on a
// desktop choosing a move scrolls only the move list's box, never the
// page (finding 8). Rokas's Italian (docs/personas/u1400.md) and
// Dovydas's backlog (docs/personas/2000plus.md).
import { expect, type Page } from '@playwright/test';
import { importRepertoire } from './support/assignments';
import { en, format, newOnboardedAccount, test } from './support/journey';
import {
  anyCount,
  chapterLine,
  chip,
  disclosure,
  knowChoice,
  plural,
} from './support/repertoires';
import {
  BACKLOG,
  BACKLOG_PGN,
  ITALIAN,
  ITALIAN_PGN,
  italian,
} from './support/training-cast';

/** Rokas's coach's comment on 3.Bc4 of the Pianissimo (fixtures/italiskoji.pgn). */
const BC4_COMMENT = 'Rikis taikosi į f7 langelį.';

/** The chapter line is closed on load, at every width: its list is not there. */
async function expectChapterLineClosed(page: Page): Promise<void> {
  const line = disclosure(page);
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await expect(line).toContainText(
    chapterLine(en, 1, italian.graph.chapters.length),
  );
  const list = String(await line.getAttribute('aria-controls'));
  await expect(page.locator(`[id="${list}"]`)).toHaveCount(0);
}

/**
 * Three steps forward with the board row, from 1...e5 to 3.Bc4: its
 * comment is in the pinned strip, and in the viewport.
 */
async function stepToCommentedMove(page: Page): Promise<void> {
  const t = en.repertoires;
  await chip(page, '1... e5').click();
  const forward = page.getByRole('button', {
    name: t.nav.forward,
    exact: true,
  });
  for (let i = 0; i < 3; i += 1) await forward.click();
  await expect(chip(page, `3. Bc4, ${t.moves.hasComment}`)).toHaveAttribute(
    'aria-current',
    'true',
  );
  const strip = page.getByRole('region', {
    name: t.panel.comment,
    exact: true,
  });
  await expect(strip.getByText(BC4_COMMENT)).toBeInViewport();
}

/** On 3.Bc4, "I know this" for the move: Mark known at once, then Learn again. */
async function knowTheMove(page: Page): Promise<void> {
  const know = en.training.know;
  const move = await knowChoice(
    page,
    en,
    format(know.move, { move: '3. Bc4' }),
  );
  await move
    .getByRole('button', { name: plural(know.markKnown, { count: 1 }) })
    .click();
  await expect(
    move.getByText(plural(know.marked, { count: 1 }), { exact: true }),
  ).toBeVisible();
  await expect(move.getByText(know.knownMove, { exact: true })).toBeVisible();
  await move
    .getByRole('button', { name: plural(know.again, { count: 1 }) })
    .click();
  await expect(
    move.getByText(plural(know.returned, { count: 1 }), { exact: true }),
  ).toBeVisible();
}

/** "I know this" for the line: Mark known asks first, with the count (R-147). */
async function knowTheLine(page: Page): Promise<void> {
  const know = en.training.know;
  const line = await knowChoice(page, en, anyCount(know.line));
  // The move learned again, all of the line's moves are new: Mark known
  // offers as many as the line has (once the choices have counted again).
  const subject = (await line.getAttribute('aria-labelledby')) ?? '';
  const named = await page.locator(`[id="${subject}"]`).textContent();
  const count = Number(/\d+/.exec(named ?? '')?.[0]);
  expect(count).toBeGreaterThan(1);
  const mark = line.getByRole('button', {
    name: plural(know.markKnown, { count }),
    exact: true,
  });
  await mark.click();
  await expect(
    line.getByText(plural(know.question, { count }), { exact: true }),
  ).toBeVisible();
  await line.getByRole('button', { name: know.confirm, exact: true }).click();
  await expect(
    line.getByText(plural(know.marked, { count }), { exact: true }),
  ).toBeVisible();
  await expect(line.getByText(anyCount(know.known))).toBeVisible();
}

test(
  '#381: the chapter line starts closed; stepping with the board row keeps the comment strip in view; I know this marks the move and the line',
  { tag: '@mobile' },
  async ({ page, request }) => {
    test.setTimeout(180_000);
    await newOnboardedAccount(page, request, 'Rokas Petrauskas');
    await importRepertoire(page, en, {
      file: ITALIAN_PGN,
      side: 'white',
      name: ITALIAN,
    });
    await expectChapterLineClosed(page);
    await stepToCommentedMove(page);
    await knowTheMove(page);
    await knowTheLine(page);
  },
);

test('#381 finding 8: choosing the last move of a long chapter does not scroll the page', async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(isMobile, 'on a phone the panel, not the move list, scrolls');
  test.setTimeout(180_000);
  await newOnboardedAccount(page, request, 'Dovydas Jankauskas');
  await importRepertoire(page, en, {
    file: BACKLOG_PGN,
    side: 'white',
    name: BACKLOG,
  });
  const moves = page.getByRole('region', {
    name: en.repertoires.moves.title,
    exact: true,
  });
  const box = page.locator('[data-moves]');
  // A chapter longer than its box, which scrolls on its own.
  expect(
    await box.evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  const chips = moves.getByRole('button');
  const scrollY = (): Promise<number> => page.evaluate(() => window.scrollY);
  // Past the frame the reveal runs in.
  const settle = (): Promise<unknown> =>
    page.evaluate(
      () =>
        new Promise((done) => {
          requestAnimationFrame(() => requestAnimationFrame(done));
        }),
    );
  // The last move, out of the box's view, chosen as a click on it: the
  // box scrolls to show it, the page does not move.
  const last = chips.last();
  const before = await scrollY();
  await last.dispatchEvent('click');
  await expect(last).toHaveAttribute('aria-current', 'true');
  await settle();
  expect(await box.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  expect(await scrollY()).toBe(before);
  // And with the pointer, once the move before it is on screen.
  const previous = chips.nth((await chips.count()) - 2);
  await previous.scrollIntoViewIfNeeded();
  const shown = await scrollY();
  await previous.click();
  await expect(previous).toHaveAttribute('aria-current', 'true');
  await settle();
  expect(await scrollY()).toBe(shown);
});
