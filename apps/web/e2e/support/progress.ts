// Coach progress steps for the S7 journey C-M1-5 (plan Task E1): the
// repertoires' own move keys read from the same PGN fixtures the browser
// imports, the counts a progress view writes, and the player's steps that
// set the journey up (sharing with the coach, making an own copy).
import { readFileSync } from 'node:fs';
import {
  importPgn,
  isUnstarted,
  percentLearned,
  playerKeys,
  type Side,
} from '@mychess/chess';
import { expect, type Page } from '@playwright/test';
import { COACH } from './assignment-people';
import { en, format, type Messages } from './journey';
import { openRepertoireOptions, plural } from './repertoires';
import { todayRow } from './today';

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
  `/coach/players/${playerId}/progress/${repertoireId}`;

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

/** The counts said after the share learned, when above zero. */
const COUNTED = ['due', 'skipped', 'notStarted'] as const;

/**
 * The counts line beside the state bar (ProgressCounts): "Not started · N
 * moves" while nothing is started, else the share learned, then the counts
 * above zero, joined by " · ".
 */
export function countsText(counts: Counts): string {
  const t = en.coach.progress;
  if (isUnstarted(counts))
    return plural(t.notStarted, { count: counts.notStarted });
  const parts = COUNTED.filter((part) => counts[part] > 0).map((part) =>
    format(t.part[part], { count: String(counts[part]) }),
  );
  return [percentText(counts), ...parts].join(t.separator);
}

/**
 * "n % learned": the learned moves only (R-177), as the app rounds it
 * (@mychess/chess `percentLearned`). Counts with no moves have no percentage.
 */
export function percentText(counts: Counts): string {
  const percent = percentLearned(counts);
  if (percent === null) throw new Error('percentText: no moves');
  return format(en.coach.progress.percent, {
    percent: String(percent),
  });
}

/**
 * From the player's repertoire page: on its Repertoire screen, shares it
 * with the coach and saves.
 */
export async function shareWithCoach(
  page: Page,
  messages: Messages,
): Promise<void> {
  await openRepertoireOptions(page, messages);
  const section = page.getByRole('region', { name: messages.share.title });
  await section.getByRole('checkbox', { name: COACH }).setChecked(true);
  await section
    .getByRole('button', { name: messages.share.save, exact: true })
    .click();
  await expect(
    section.getByText(plural(messages.share.sharedWith, { count: 1 }), {
      exact: true,
    }),
  ).toBeVisible();
}

/** From Today, the player makes their own copy of `name`; returns its id. */
export async function makeOwnCopy(
  page: Page,
  messages: Messages,
  name: string,
): Promise<string> {
  const t = messages.assignment.fork;
  await page.goto('/');
  await todayRow(page, messages, name)
    .getByRole('link', { name, exact: true })
    .click();
  await expect(page).toHaveURL(/\/repertoires\/assigned\//);
  // Through More: the Repertoire screen asks nothing until it is pressed.
  await openRepertoireOptions(page, messages);
  await expect(page.getByText(format(t.question, { name }))).toHaveCount(0);
  await page.getByRole('button', { name: t.label, exact: true }).click();
  await page.getByRole('button', { name: t.confirm, exact: true }).click();
  await expect(page).toHaveURL(/\/repertoires\/[0-9a-f-]{36}$/);
  return idIn(page.url());
}
