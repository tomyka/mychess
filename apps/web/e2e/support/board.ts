import { expect, type Page } from '@playwright/test';

/** How a person reaches the board: the page, phone or desktop, and which side is at the bottom. */
export interface BoardHand {
  readonly page: Page;
  readonly isMobile: boolean;
  readonly orientation?: 'white' | 'black';
}

/** The centre of `square` on the page's board, as `hand` sees it. */
async function squareCentre(
  { page, orientation = 'white' }: BoardHand,
  square: string,
): Promise<{ x: number; y: number }> {
  const board = page.locator('cg-board');
  await expect(board).toBeVisible();
  const box = await board.boundingBox();
  if (box === null) throw new Error('no board on the page');
  const file = 'abcdefgh'.indexOf(square.charAt(0));
  const rank = Number(square.charAt(1)) - 1;
  if (file < 0 || rank < 0 || rank > 7) throw new Error(`no square ${square}`);
  const column = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  const size = box.width / 8;
  return { x: box.x + (column + 0.5) * size, y: box.y + (row + 0.5) * size };
}

/**
 * Presses `square` as a person does: a tap on a phone, a click on a desktop.
 * Both are trusted input, which is all chessground listens to.
 */
export async function pressSquare(
  hand: BoardHand,
  square: string,
): Promise<void> {
  const { x, y } = await squareCentre(hand, square);
  if (hand.isMobile) await hand.page.touchscreen.tap(x, y);
  else await hand.page.mouse.click(x, y);
}

/** Plays a move by pressing its two squares: chessground's tap-tap. */
export async function playOnBoard(
  hand: BoardHand,
  orig: string,
  dest: string,
): Promise<void> {
  await pressSquare(hand, orig);
  await pressSquare(hand, dest);
}
