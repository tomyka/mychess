// The part 4 Sheet (src/app/sheet.tsx) as a person sees it: a bottom sheet
// on a phone, a centred dialog from md (#381 part 6).
import { expect, type Locator, type Page } from '@playwright/test';

/** Within two pixels: a box's edges may fall between device pixels. */
const near = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= 2;

/**
 * `dialog` is open in the shape the screen gives it: on a phone pinned to
 * the bottom edge across the whole width, on a desktop centred and
 * narrower than the window. Where it sits is the behaviour here, so the
 * check reads its box.
 */
export async function expectSheetShape(
  page: Page,
  dialog: Locator,
  phone: boolean,
): Promise<void> {
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null)
    throw new Error('the dialog or the window has no size');
  const bottom = box.y + box.height;
  if (phone) {
    expect(near(box.x, 0), `left edge ${String(box.x)}`).toBe(true);
    expect(near(box.width, viewport.width), 'full width').toBe(true);
    expect(near(bottom, viewport.height), `bottom ${String(bottom)}`).toBe(
      true,
    );
  } else {
    expect(box.width).toBeLessThan(viewport.width);
    expect(
      near(box.x + box.width / 2, viewport.width / 2),
      'centred across',
    ).toBe(true);
    expect(bottom).toBeLessThan(viewport.height);
  }
}
