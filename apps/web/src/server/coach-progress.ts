import 'server-only';
// The coach's progress page loader (R-152). It starts with requireCoach()
// and parses its ids before any read; the acting coach is always the
// session's. The db read decides access through the domain and filters
// again in SQL; an undefined read is a plain 404 (S4 plan decision 4).
import {
  coachRepertoireProgress,
  type CoachStatus,
  type RepertoireProgressView,
  type RepertoireRef,
} from '@mychess/db';
import type { ChapterProgress, Standing } from '@mychess/chess';
import { vilniusDay, type AccountRef } from '@mychess/domain';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { accountIdSchema } from './account-id';
import { chapterLabelOf } from './chapter-names';
import { requireCoach } from './coaching';
import { getDb } from './db';

/** A chapter of the progress page, with its title. */
export interface ChapterRow extends Omit<ChapterProgress, 'chapter'> {
  readonly id: string;
  readonly title: string;
}

/**
 * How the coach has the repertoire, as the player page tags it: their own
 * assignment, shared with them, or the player's Fork of one of the coach's
 * repertoires, shared with them (R-155, #328).
 */
type ProgressTag = 'assigned' | 'shared' | 'fork';

/** The progress page (R-152). */
export interface ProgressPage {
  readonly player: AccountRef;
  readonly repertoire: RepertoireRef;
  readonly tag: ProgressTag;
  /** The assignment's deadline and status; null for a shared repertoire. */
  readonly status: CoachStatus | null;
  /** Today in Vilnius, so the server and the browser word deadlines alike. */
  readonly today: string;
  readonly standing: Standing;
  readonly chapters: readonly ChapterRow[];
}

const tagOf = ({
  source,
  forkOf,
}: Pick<RepertoireProgressView, 'source' | 'forkOf'>): ProgressTag =>
  forkOf === null ? source : 'fork';

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
  const now = new Date();
  const view =
    (await coachRepertoireProgress(
      getDb(),
      { coachId: coach.id, ...parsed.data },
      now,
    )) ?? notFound();
  const title = chapterLabelOf(view.graph);
  const { counts, mastered, chapters } = view.progress;
  return {
    player: view.player,
    repertoire: view.repertoire,
    tag: tagOf(view),
    status: view.status,
    today: vilniusDay(now),
    standing: { counts, mastered },
    chapters: chapters.map(({ chapter, ...rest }) => ({
      ...rest,
      id: chapter.id,
      title: title(chapter),
    })),
  };
}
