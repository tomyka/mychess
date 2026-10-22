/**
 * The one share predicate and the reads built on it (issue #278): which
 * shares a coach may use, held or not. repertoires/scope.ts, shares.ts and
 * coach-notes.ts use these; nothing else spells the share condition.
 * Internal to the package.
 */
import { and, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor, Tx } from './client';
import { linkExists } from './coach-queries';
import { isUuid } from './ids';
import { repertoireShares, repertoires } from './schema';

/**
 * The shares `coachId` may use of `playerId`'s repertoires: theirs, to this
 * coach, through an active Coach link. The link foreign key already ends a
 * share on unlink; the join is the second line (decision 2, checklist 1).
 */
export const sharedTo = (coachId: string, playerId: string): SQL | undefined =>
  and(
    eq(repertoireShares.coachId, coachId),
    eq(repertoireShares.playerId, playerId),
    linkExists(repertoireShares.coachId, repertoireShares.playerId),
  );

const ownerRowsSchema = z.array(z.object({ ownerId: z.string().min(1) }));

/**
 * The owner of repertoire `id`, holding its row (key share) until `tx`
 * ends, or undefined when there is no such repertoire.
 */
export async function holdRepertoireOwner(
  tx: Tx,
  id: string,
): Promise<string | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = ownerRowsSchema.parse(
    await tx
      .select({ ownerId: repertoires.ownerAccountId })
      .from(repertoires)
      .where(eq(repertoires.id, id))
      .for('key share'),
  );
  return row?.ownerId;
}

const idRowsSchema = z.array(z.object({ id: z.uuid() }));

/** Which shares sharedIds reads, and whether it holds them. */
export interface SharedIdsScope {
  /** Only this repertoire's share. */
  readonly repertoireId?: string;
  /** Hold the share rows (FOR SHARE) until the transaction ends. */
  readonly hold?: boolean;
}

/** The ids of the player's repertoires shared with this coach, as sharedTo has them. */
export async function sharedIds(
  db: Executor,
  coachId: string,
  playerId: string,
  scope: SharedIdsScope = {},
): Promise<Set<string>> {
  const query = db
    .select({ id: repertoireShares.repertoireId })
    .from(repertoireShares)
    .where(
      and(
        sharedTo(coachId, playerId),
        scope.repertoireId === undefined
          ? undefined
          : eq(repertoireShares.repertoireId, scope.repertoireId),
      ),
    );
  const rows = idRowsSchema.parse(
    await (scope.hold === true ? query.for('share') : query),
  );
  return new Set(rows.map((row) => row.id));
}
