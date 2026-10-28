// The coach's progress page loader (R-152). It starts with requireCoach()
// and parses its ids before any read; the acting coach is always the
// session's. The db read decides access through the domain and filters
// again in SQL; an undefined read is a plain 404 (S4 plan decision 4).
import { coachRepertoireProgress, type RepertoireRef } from '@mychess/db';
import type { ChapterProgress, Standing } from '@mychess/chess';
import type { AccountRef, BadgeSet } from '@mychess/domain';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { accountIdSchema } from './account-id';
import { chapterLabelIn } from './chapter-names';
import { requireCoach } from './coaching';
import { getDb } from './db';

/** A chapter of the progress page, named in the coach's locale. */
export interface ChapterRow extends Omit<ChapterProgress, 'chapter'> {
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
  const title = chapterLabelIn(view.graph, coach.locale);
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
