/**
 * What changed in an assigned repertoire since its player last saw it
 * (R-133, R-136), read through the shared player-live reads in one
 * repeatable-read snapshot.
 */
import {
  moveChangesSchema,
  netMoveChanges,
  type MoveChanges,
} from '@mychess/chess';
import { newsOf } from '@mychess/domain';
import { and, asc, gt, lte } from 'drizzle-orm';
import { z } from 'zod';
import { REPEATABLE_READ, type Executor } from '../client';
import { isUuid } from '../ids';
import { repertoireChanges } from '../assignment-schema';
import { inLive, seenFacts, usableAssignment } from './player-live';

/** What changed since the player last saw a repertoire (R-133). */
export interface ChangesSince {
  /** The net of every change since, by move and chapter. */
  readonly changes: MoveChanges;
}

/** The player, the repertoire and the version their page showed. */
export interface ChangesRequest {
  /** The session account, never a client value. */
  readonly playerId: string;
  readonly repertoireId: string;
  /**
   * The repertoire version the page read with its graph: changes after it
   * wait for the next visit, so the summary matches the graph shown.
   */
  readonly upToVersion: number;
}

const changeRowsSchema = z.array(
  z.object({
    version: z.number().int(),
    createdAt: z.date(),
    changes: moveChangesSchema,
  }),
);

/**
 * The net of the changes to the player's live assignment that are news to
 * them (newsOf: after the version they last saw and after they had it,
 * R-133, R-136), up to and including `upToVersion`, in version order;
 * undefined unless it is theirs.
 */
export function changesSince(
  db: Executor,
  { playerId, repertoireId, upToVersion }: ChangesRequest,
): Promise<ChangesSince | undefined> {
  if (!isUuid(repertoireId)) return Promise.resolve(undefined);
  return db.transaction(async (tx) => {
    const assignment = await usableAssignment(tx, playerId, repertoireId);
    if (assignment === undefined) return undefined;
    const rows = changeRowsSchema.parse(
      await tx
        .select({
          version: repertoireChanges.version,
          createdAt: repertoireChanges.createdAt,
          changes: repertoireChanges.changes,
        })
        .from(repertoireChanges)
        .where(
          and(
            inLive(tx, repertoireChanges.repertoireId, {
              playerId,
              repertoireId,
            }),
            gt(repertoireChanges.version, assignment.seenVersion ?? 0),
            lte(repertoireChanges.version, upToVersion),
          ),
        )
        .orderBy(asc(repertoireChanges.version)),
    );
    const news = newsOf(seenFacts(assignment), rows);
    return { changes: netMoveChanges(news.map((row) => row.changes)) };
  }, REPEATABLE_READ);
}
