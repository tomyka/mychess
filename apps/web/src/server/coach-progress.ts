// The coach's progress loaders (S7). Each starts with requireCoach() and
// parses its ids before any read; the acting coach is always the session's.
// The db read decides access through the domain and filters again in SQL;
// an undefined read is a plain 404 (S4 plan decision 4). Dates leave as
// whole Vilnius days ago, so the server and browser render the same text
// (R-154).
import {
  coachGroupProgress,
  coachPlayerProgress,
  coachRepertoireProgress,
  type GroupProgressCell,
  type ProgressRow,
  type RepertoireRef,
} from '@mychess/db';
import type { ChapterProgress, Standing } from '@mychess/chess';
import type { Account, AccountRef, BadgeSet } from '@mychess/domain';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { daysSince } from '../lib/days-ago';
import { accountIdSchema } from './account-id';
import { chapterTitleIn } from './chapter-names';
import { requireCoach } from './coaching';
import { getDb } from './db';

/** The player page's progress section. */
export interface PlayerProgressSection {
  readonly rows: readonly ProgressRow[];
  /** Whole Vilnius days since the player last trained; null for never. */
  readonly lastTrainedDays: number | null;
}

/**
 * The progress section of the player page, for `coachPlayerData`: the
 * session coach, the player id it parsed, and its `now`. Not a page loader.
 * The db read checks access again in its own snapshot and is undefined
 * unless the coach is linked to the player, so this fails closed (404)
 * even when called on its own.
 */
export async function playerProgressData(
  coach: Pick<Account, 'id'>,
  playerId: string,
  now: Date,
): Promise<PlayerProgressSection> {
  const read =
    (await coachPlayerProgress(getDb(), coach.id, playerId, now)) ?? notFound();
  return {
    rows: read.rows,
    lastTrainedDays: daysSince(read.lastTrained, now),
  };
}

/** A chapter of the progress page, named in the coach's locale. */
interface ChapterRow extends Omit<ChapterProgress, 'chapter'> {
  readonly id: string;
  readonly title: string;
}

/** The progress page (R-152). */
export interface ProgressPage {
  readonly player: AccountRef;
  readonly repertoire: RepertoireRef;
  readonly badges: BadgeSet | null;
  readonly standing: Standing;
  readonly chapters: readonly ChapterRow[];
}

const idsSchema = z.object({
  playerId: accountIdSchema,
  repertoireId: z.uuid(),
});

/**
 * One player's progress on one repertoire. A malformed id, an unlinked
 * player, a private or forked repertoire: all 404.
 */
export async function coachProgressData(
  rawPlayerId: unknown,
  rawRepertoireId: unknown,
): Promise<ProgressPage> {
  const coach = await requireCoach();
  const parsed = idsSchema.safeParse({
    playerId: rawPlayerId,
    repertoireId: rawRepertoireId,
  });
  if (!parsed.success) notFound();
  const view =
    (await coachRepertoireProgress(
      getDb(),
      { coachId: coach.id, ...parsed.data },
      new Date(),
    )) ?? notFound();
  const title = chapterTitleIn(coach.locale);
  const { counts, mastered, chapters } = view.progress;
  return {
    player: view.player,
    repertoire: view.repertoire,
    badges: view.badges,
    standing: { counts, mastered },
    chapters: chapters.map(({ chapter, ...rest }) => ({
      ...rest,
      id: chapter.id,
      title: title(chapter),
    })),
  };
}

/** One member's row of the group grid. */
interface GridRow {
  readonly player: AccountRef;
  readonly lastTrainedDays: number | null;
  /** One per column, in column order; null without an assignment. */
  readonly cells: readonly (GroupProgressCell | null)[];
}

/** The group grid (R-153). */
export interface GroupGrid {
  readonly columns: readonly RepertoireRef[];
  readonly rows: readonly GridRow[];
}

/** The grid of the coach's own group; any other group is 404. */
export async function groupProgressData(
  rawGroupId: unknown,
): Promise<GroupGrid> {
  const coach = await requireCoach();
  const parsed = z.uuid().safeParse(rawGroupId);
  if (!parsed.success) notFound();
  const now = new Date();
  const grid =
    (await coachGroupProgress(getDb(), coach.id, parsed.data, now)) ??
    notFound();
  return {
    columns: grid.columns,
    rows: grid.rows.map((row) => ({
      player: row.player,
      lastTrainedDays: daysSince(row.lastTrained, now),
      cells: row.cells,
    })),
  };
}
