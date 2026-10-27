// Coach progress steps for the S7 journey C-M1-5 (plan Task E1): the
// repertoires' own move keys read from the same PGN fixtures the browser
// imports, the counts a progress view writes, and the player's steps that
// set the journey up (sharing with the coach, making an own copy).
import { readFileSync } from 'node:fs';
import { importPgn, playerKeys, type Side } from '@mychess/chess';
import { expect, type Page } from '@playwright/test';
import { COACH } from './assignment-people';
import { homeAssignment } from './assignments';
import { CATALOGUES, format, type Locale, type Messages } from './journey';
import { plural } from './repertoires';

/**
 * The player's own move keys of `file` as the app imports it for `side`,
 * in the PGN's order. With `whole`, a skipped game or move fails here, so
 * the fixture is proven legal with @mychess/chess.
 */
export function ownKeysOf(file: string, side: Side, whole: boolean): string[] {
  const imported = importPgn(readFileSync(file, 'utf8'), side);
  if (!imported.ok) throw new Error(`${file}: ${imported.refusal.reason}`);
  const { graph, skipped } = imported.value;
  if (whole && skipped.length > 0)
    throw new Error(`${file} skips ${JSON.stringify(skipped)}`);
  return playerKeys(graph);
}

/** The id at the end of a page's path (a repertoire, a player). */
export function idIn(url: string): string {
  const id = /\/([^/]+)$/.exec(new URL(url).pathname)?.[1];
  if (id === undefined) throw new Error(`no id in ${url}`);
  return id;
}

/** The coach's progress page of a player on a repertoire (src/lib/routes.ts). */
export const progressPath = (playerId: string, repertoireId: string): string =>
  `/treneris/zaidejai/${playerId}/pazanga/${repertoireId}`;

/** The four states of R-151, counted. */
export interface Counts {
  readonly learned: number;
  readonly due: number;
  readonly skipped: number;
  readonly notStarted: number;
}

/** `total` own moves, none started. */
export const notStarted = (total: number): Counts => ({
  learned: 0,
  due: 0,
  skipped: 0,
  notStarted: total,
});

/** The state bar's counts line in `locale`. */
export const countsText = (locale: Locale, counts: Counts): string =>
  plural(CATALOGUES[locale].coach.progress.counts, locale, { ...counts });

/** "n % learned": the moves with a Review, as a whole percentage. */
export function percentText(locale: Locale, counts: Counts): string {
  const started = counts.learned + counts.due + counts.skipped;
  const percent = Math.round((started / (started + counts.notStarted)) * 100);
  return format(CATALOGUES[locale].coach.progress.percent, {
    percent: String(percent),
  });
}

/** On the player's repertoire page: shares it with the coach and saves. */
export async function shareWithCoach(
  page: Page,
  messages: Messages,
  locale: Locale,
): Promise<void> {
  const section = page.getByRole('region', { name: messages.share.title });
  await section.getByRole('checkbox', { name: COACH }).setChecked(true);
  await section
    .getByRole('button', { name: messages.share.save, exact: true })
    .click();
  await expect(
    section.getByText(plural(messages.share.sharedWith, locale, { count: 1 }), {
      exact: true,
    }),
  ).toBeVisible();
}

/** From home, the player makes their own copy of `name`; returns its id. */
export async function makeOwnCopy(
  page: Page,
  messages: Messages,
  name: string,
): Promise<string> {
  const t = messages.assignment.fork;
  await page.goto('/');
  await homeAssignment(page, messages, name)
    .getByRole('link', { name, exact: true })
    .click();
  await expect(page).toHaveURL(/\/repertuarai\/priskirti\//);
  await page.getByRole('button', { name: t.label, exact: true }).click();
  await page.getByRole('button', { name: t.confirm, exact: true }).click();
  await expect(page).toHaveURL(/\/repertuarai\/[0-9a-f-]{36}$/);
  return idIn(page.url());
}
