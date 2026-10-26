// Training steps for the S6 E2E journeys (plan Task D3): the repertoires a
// journey trains, read from the same PGN fixtures the browser imports, and
// the drill as a person plays it: read the line so far and the title,
// play the move the repertoire holds there (or a wrong one), until done.
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import {
  importPgn,
  isPlayerMove,
  legalMoves,
  moveKey,
  playerKeys,
  START_KEY,
  type RepertoireGraph,
  type RepertoireMove,
  type Side,
} from '@mychess/chess';
import { playOnBoard } from './board';
import type { Messages } from './journey';

/** A repertoire a journey trains: its name in the app and its graph. */
interface Book {
  readonly name: string;
  readonly graph: RepertoireGraph;
}

/**
 * `file` as the app imports it for `side`, named `name`. The fixture must
 * import whole: a skipped game or move (illegal, or a second answer) fails
 * here, so every journey proves its PGN legal with @mychess/chess.
 */
export function bookOf(file: string, side: Side, name: string): Book {
  const imported = importPgn(readFileSync(file, 'utf8'), side);
  if (!imported.ok) throw new Error(`${file}: ${imported.refusal.reason}`);
  const { graph, skipped } = imported.value;
  if (skipped.length > 0)
    throw new Error(`${file} skips ${JSON.stringify(skipped)}`);
  return { name, graph };
}

/** The player's own move keys of `book`, in the PGN's order. */
export const ownKeys = (book: Book): string[] => playerKeys(book.graph);

/** The key of the player's move `san` after the moves `sans` from the start. */
export function keyAfter(
  book: Book,
  sans: readonly string[],
  san: string,
): string {
  return moveKey(positionAfter(book.graph, sans), san);
}

/** The position after `sans` from the start, along the graph's moves. */
function positionAfter(
  graph: RepertoireGraph,
  sans: readonly string[],
): string {
  let key = START_KEY;
  for (const san of sans) {
    const move = graph.moves.find((m) => m.from === key && m.san === san);
    if (move === undefined) throw new Error(`no ${san} at ${key}`);
    key = move.to;
  }
  return key;
}

/** What the drill asks: in which repertoire, at which position, and the answer. */
export interface Asked {
  readonly book: string;
  readonly line: string;
  readonly key: string;
  readonly move: RepertoireMove;
  /** What the panel said while asking. */
  readonly prompt: string;
}

/** One drill on a page, with the repertoires it may show. */
export interface Drill {
  readonly page: Page;
  readonly messages: Messages;
  readonly books: readonly Book[];
  readonly isMobile: boolean;
}

/** How the move is played: typed, tapped on the board, or a wrong one typed. */
type Play = 'type' | 'board' | 'wrong';

const escape = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The panel's words while a move is asked, review and learn alike. */
function askingTexts(messages: Messages): string[] {
  const { review, learn } = messages.training;
  return [
    review.prompt,
    review.lapse,
    review.hinted,
    learn.arrows,
    learn.blind,
    learn.known,
    learn.wrong,
  ];
}

/** The panel's line while a move is asked. */
const asking = (d: Drill): Locator =>
  d.page.getByText(
    new RegExp(`^(${askingTexts(d.messages).map(escape).join('|')})$`),
  );

/** The done summary's heading. */
export const doneHeading = (page: Page, messages: Messages): Locator =>
  page.getByRole('heading', { name: messages.training.done.title });

/** The typed-move field. */
const moveField = (page: Page, messages: Messages): Locator =>
  page.getByLabel(messages.board.moveInput.label, { exact: true });

/** The line so far, as its moves' SAN (the panel writes it with numbers). */
async function lineSans(d: Drill): Promise<string[]> {
  const line = d.page
    .getByRole('heading', { name: d.messages.training.drill.line })
    .locator('xpath=following-sibling::p');
  if ((await line.count()) === 0) return [];
  const text = (await line.textContent()) ?? '';
  return text.split(/\s+/).filter((t) => t !== '' && !/^\d+\.+$/.test(t));
}

/** What is asked now, from the title, the line so far and the panel. */
async function readAsked(d: Drill): Promise<Asked> {
  const title = await d.page.getByRole('heading', { level: 1 }).textContent();
  const book = d.books.find((b) => b.name === title);
  if (book === undefined) throw new Error(`no repertoire "${String(title)}"`);
  const sans = await lineSans(d);
  const key = positionAfter(book.graph, sans);
  const move = book.graph.moves.find(
    (m) => m.from === key && isPlayerMove(book.graph, m),
  );
  if (move === undefined)
    throw new Error(`nothing asked after ${String(sans)}`);
  const prompt = (await asking(d).textContent()) ?? '';
  return { book: book.name, line: sans.join(' '), key, move, prompt };
}

/** A legal move at `key` other than `san`. */
function wrongMove(key: string, san: string): string {
  const other = legalMoves(key).find((m) => m.san !== san);
  if (other === undefined) throw new Error(`only ${san} is legal at ${key}`);
  return other.san;
}

/** Plays `san` in the move field; true once the drill took it. */
async function typed(d: Drill, san: string): Promise<void> {
  const field = moveField(d.page, d.messages);
  await field.fill(san);
  await field.press('Enter');
  await expect(field).toHaveValue('', { timeout: 1_000 });
}

/** Plays `move` on the board; the line moves on once the drill took it. */
async function tapped(d: Drill, asked: Asked): Promise<void> {
  await playOnBoard(
    { page: d.page, isMobile: d.isMobile },
    asked.move.uci.slice(0, 2),
    asked.move.uci.slice(2, 4),
  );
  await expect(async () => {
    const moved = (await lineSans(d)).join(' ') !== asked.line;
    const done = await doneHeading(d.page, d.messages).isVisible();
    expect(moved || done).toBe(true);
  }).toPass({ timeout: 1_500 });
}

/**
 * Waits for the drill to ask, then answers as `how` says. Retried while
 * the board is still busy (the opponent's reply sliding in takes no move).
 */
export async function answer(d: Drill, how: Play = 'type'): Promise<Asked> {
  let asked: Asked | undefined;
  await expect(async () => {
    await expect(asking(d)).toBeVisible({ timeout: 2_000 });
    asked = await readAsked(d);
    if (how === 'board') await tapped(d, asked);
    else
      await typed(
        d,
        how === 'wrong' ? wrongMove(asked.key, asked.move.san) : asked.move.san,
      );
  }).toPass({ timeout: 20_000 });
  if (asked === undefined) throw new Error('nothing was asked');
  return asked;
}

/** Answers every move right, typed, until the done summary; returns what was asked. */
export async function drillToDone(d: Drill): Promise<Asked[]> {
  const done = doneHeading(d.page, d.messages);
  const seen: Asked[] = [];
  for (;;) {
    await expect(asking(d).or(done)).toBeVisible({ timeout: 10_000 });
    if (await done.isVisible()) return seen;
    seen.push(await answer(d));
  }
}

/** The top bar's "done / total". */
export async function counter(
  page: Page,
): Promise<{ done: number; total: number }> {
  const text =
    (await page
      .locator('header p')
      .filter({ hasText: /\d+ \/ \d+/ })
      .textContent()) ?? '';
  const match = /(\d+) \/ (\d+)/.exec(text);
  if (match === null) throw new Error(`no counter in "${text}"`);
  return { done: Number(match[1]), total: Number(match[2]) };
}

/** The top bar reads `done / total`. */
export async function expectCounter(
  page: Page,
  done: number,
  total: number,
): Promise<void> {
  await expect(
    page.locator('header p').filter({ hasText: /\d+ \/ \d+/ }),
  ).toHaveText(new RegExp(`${String(done)} / ${String(total)}$`));
}

/** In settings, the training limits (R-146), saved. */
export async function setTrainingLimits(
  page: Page,
  messages: Messages,
  limits: { sessionSize?: number; newPerDay?: number },
): Promise<void> {
  const t = messages.training.settings;
  await page.goto('/nustatymai');
  const section = page.getByRole('region', { name: t.title });
  if (limits.sessionSize !== undefined)
    await section
      .getByLabel(t.sessionSizeLabel, { exact: true })
      .fill(String(limits.sessionSize));
  if (limits.newPerDay !== undefined)
    await section
      .getByLabel(t.newPerDayLabel, { exact: true })
      .fill(String(limits.newPerDay));
  await section.getByRole('button', { name: t.submit }).click();
  await expect(section.getByText(t.saved, { exact: true })).toBeVisible();
}
