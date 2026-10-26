/**
 * The facts coach progress is decided on, for many players at once
 * (R-39, R-42, R-154): link, shares and this coach's assignments, in a
 * fixed number of statements. The domain decides (canCoachSeeProgress,
 * progressRepertoireIds); `lastTrained` filters on its answer. Internal to
 * the package.
 */
import {
  progressRepertoireIds,
  type CoachProgressFacts,
  type PlayerRepertoire,
} from '@mychess/domain';
import { and, eq, exists, max, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { inIds, inPairs } from '../assignments/pairs';
import { assignmentFacts } from '../assignments/reach';
import type { Executor } from '../client';
import { playerRowsSchema } from '../coach-queries';
import { coachLinks } from '../schema';
import { sharedPairs } from '../share-scope';
import { reviewResults } from '../training-schema';

/** Which of `playerIds` are linked to `coachId`: one statement. */
async function linkedOf(
  db: Executor,
  coachId: string,
  playerIds: readonly string[],
): Promise<Set<string>> {
  const rows = playerRowsSchema.parse(
    await db
      .select({ playerId: coachLinks.playerId })
      .from(coachLinks)
      .where(
        and(
          eq(coachLinks.coachId, coachId),
          inIds(coachLinks.playerId, playerIds),
        ),
      ),
  );
  return new Set(rows.map((row) => row.playerId));
}

/**
 * canCoachSeeProgress's facts for each of `playerIds`. A fixed number of
 * statements whatever the number of players; none for no players.
 */
export async function coachProgressFacts(
  db: Executor,
  coachId: string,
  playerIds: readonly string[],
): Promise<Map<string, CoachProgressFacts>> {
  if (playerIds.length === 0) return new Map();
  const linked = await linkedOf(db, coachId, playerIds);
  const shares = await sharedPairs(db, coachId, playerIds);
  const assignments = await assignmentFacts(db, { playerIds, coachId });
  return new Map(
    playerIds.map((playerId) => [
      playerId,
      {
        linked: linked.has(playerId),
        sharedRepertoireIds: new Set(
          shares
            .filter((s) => s.playerId === playerId)
            .map((s) => s.repertoireId),
        ),
        assignments: assignments.filter((a) => a.playerId === playerId),
      },
    ]),
  );
}

const lastRowsSchema = z.array(
  z.object({ playerId: z.string().min(1), at: z.date() }),
);

/** The (player, repertoire) pairs whose results count for "last trained". */
const visiblePairs = (
  coachId: string,
  facts: ReadonlyMap<string, CoachProgressFacts>,
): PlayerRepertoire[] =>
  [...facts].flatMap(([playerId, one]) =>
    [...progressRepertoireIds(coachId, playerId, one)].map((repertoireId) => ({
      playerId,
      repertoireId,
    })),
  );

/** The result's player is linked to `coachId` now: the query's second line. */
const linkedTo = (db: Executor, coachId: string): SQL =>
  exists(
    db
      .select({ one: sql`1` })
      .from(coachLinks)
      .where(
        and(
          eq(coachLinks.coachId, coachId),
          eq(coachLinks.playerId, reviewResults.playerId),
        ),
      ),
  );

/**
 * When each player last trained on a repertoire the coach may see
 * progress on (R-154): the latest `answered_at` (when they trained, not
 * when the batch arrived). One statement, none when there is no such
 * repertoire; no entry for a player without such a result.
 * Precondition: `facts` must come from coachProgressFacts, called in the
 * same (repeatable-read) transaction as `db`; never cached, serialised or
 * passed in from outside the package.
 */
export async function lastTrained(
  db: Executor,
  coachId: string,
  facts: ReadonlyMap<string, CoachProgressFacts>,
): Promise<Map<string, Date>> {
  const pairs = visiblePairs(coachId, facts);
  if (pairs.length === 0) return new Map();
  const rows = lastRowsSchema.parse(
    await db
      .select({
        playerId: reviewResults.playerId,
        at: max(reviewResults.answeredAt),
      })
      .from(reviewResults)
      .where(
        and(
          inPairs(reviewResults.playerId, reviewResults.repertoireId, pairs),
          linkedTo(db, coachId),
        ),
      )
      .groupBy(reviewResults.playerId),
  );
  return new Map(rows.map((row) => [row.playerId, row.at]));
}
