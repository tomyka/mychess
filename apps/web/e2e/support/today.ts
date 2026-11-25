// Today (#381 part 2) as a player reads it: the hero card headed "Today's
// review" and the list "My repertoires", one row per repertoire the player
// trains, own and assigned (R-221, R-222).
import { expect, type Locator, type Page } from '@playwright/test';
import { format, type Messages } from './journey';

/** Today's hero card, named "Today's review" in every state. */
export const today = (page: Page, messages: Messages): Locator =>
  page.getByRole('region', { name: messages.training.today.title });

/** On Today: the hero shows `count` due and about `minutes` (8 s a move, rounded up). */
export async function expectDue(
  page: Page,
  messages: Messages,
  count: number,
): Promise<void> {
  const hero = today(page, messages);
  const text = (message: string, values: Record<string, string>): Locator =>
    hero.getByText(format(message, values), { exact: true });
  await expect(
    text(messages.today.dueCount, { count: String(count) }),
  ).toBeVisible();
  await expect(
    text(messages.today.minutes, {
      minutes: String(Math.ceil((count * 8) / 60)),
    }),
  ).toBeVisible();
}

/** From Today, starts today's review of every repertoire. */
export async function startTodayReview(
  page: Page,
  messages: Messages,
): Promise<void> {
  await today(page, messages)
    .getByRole('link', { name: messages.training.today.start, exact: true })
    .click();
  await expect(page).toHaveURL(/\/training\?mode=review$/);
}

/** Today's list "My repertoires" (absent in the empty state). */
export const todayList = (page: Page, messages: Messages): Locator =>
  page.getByRole('region', { name: messages.today.repertoires });

/** The row of `name`: the list item whose name link is `name` exactly. */
export const todayRow = (
  page: Page,
  messages: Messages,
  name: string,
): Locator =>
  todayList(page, messages)
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name, exact: true }) });

/** A row's own button: "Review n", or "Learn" without a count. */
export const rowAction = (
  row: Locator,
  messages: Messages,
  review?: number,
): Locator =>
  row.getByRole('link', {
    name:
      review === undefined
        ? messages.today.learn
        : format(messages.today.review, { count: String(review) }),
    exact: true,
  });
