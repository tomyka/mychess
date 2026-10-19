/**
 * A Player's own repertoires shared with linked coaches (R-42). The domain
 * decides (canShare, canCoachSee); every coach-facing query enforces it
 * again through sharedTo (share-scope.ts), the one share predicate: a share
 * counts only for this coach and this player, and only through an active
 * Coach link (checklist 1-3). Nothing here reads personal_notes
 * (checklist 2). The notes on a share are in coach-notes.ts.
 */
import { sideSchema } from '@mychess/chess';
import {
  canShare,
  SHARE_REFUSALS,
  type Result,
  type ShareRefusal,
} from '@mychess/domain';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from './client';
import { holdLink } from './coach-queries';
import { coachOwnNotes, type CoachNote } from './coach-notes';
import { isUuid } from './ids';
import {
  loadRepertoireRows,
  type LoadedRepertoire,
} from './repertoires/repository';
import { DONE, refusal } from './results';
import { accounts, repertoireShares, repertoires } from './schema';
import { holdRepertoireOwner, sharedIds, sharedTo } from './share-scope';

/** A share's three parts. */
export interface ShareTarget {
  /** The account sharing: the session's, never one a client names. */
  readonly ownerId: string;
  readonly repertoireId: string;
  readonly coachId: string;
}

export interface ShareRequest extends ShareTarget {
  readonly now: Date;
}

/**
 * Shares the owner's repertoire with a coach linked to them (R-42); sharing
 * again changes nothing. The link and then the repertoire are held while
 * the share is written, the order an unlink and an account delete take
 * them, so either waits rather than racing it or deadlocking with it.
 */
export async function shareRepertoire(
  db: Executor,
  request: ShareRequest,
): Promise<Result<undefined, ShareRefusal>> {
  return db.transaction(async (tx) => {
    const linked = await holdLink(tx, request.coachId, request.ownerId);
    const ownerId = await holdRepertoireOwner(tx, request.repertoireId);
    if (ownerId === undefined) return refusal(SHARE_REFUSALS.notOwner);
    const check = canShare(
      request.ownerId,
      { ownerId },
      request.coachId,
      linked,
    );
    if (!check.ok) return check;
    await tx
      .insert(repertoireShares)
      .values({
        repertoireId: request.repertoireId,
        playerId: request.ownerId,
        coachId: request.coachId,
        createdAt: request.now,
      })
      .onConflictDoNothing();
    return DONE;
  });
}

/**
 * Ends the owner's share of a repertoire with one coach; anyone else's is
 * untouched. That coach's notes on it go in the same statement, by the
 * coach_notes_share_fk cascade (R-124).
 */
export async function unshareRepertoire(
  db: Executor,
  target: ShareTarget,
): Promise<void> {
  if (!isUuid(target.repertoireId)) return;
  await db
    .delete(repertoireShares)
    .where(
      and(
        eq(repertoireShares.repertoireId, target.repertoireId),
        eq(repertoireShares.playerId, target.ownerId),
        eq(repertoireShares.coachId, target.coachId),
      ),
    );
}

const coachIdRowsSchema = z.array(z.object({ coachId: z.string().min(1) }));

/** The coaches the owner shares a repertoire with, by id; none for anyone else. */
export async function sharedCoachIds(
  db: Executor,
  ownerId: string,
  repertoireId: string,
): Promise<string[]> {
  if (!isUuid(repertoireId)) return [];
  const rows = coachIdRowsSchema.parse(
    await db
      .select({ coachId: repertoireShares.coachId })
      .from(repertoireShares)
      .where(
        and(
          eq(repertoireShares.repertoireId, repertoireId),
          eq(repertoireShares.playerId, ownerId),
        ),
      )
      .orderBy(asc(repertoireShares.coachId)),
  );
  return rows.map((row) => row.coachId);
}

export interface SharedRepertoireItem {
  readonly id: string;
  readonly name: string;
  readonly side: z.infer<typeof sideSchema>;
}

const sharedRowsSchema = z.array(
  z.object({ id: z.uuid(), name: z.string(), side: sideSchema }),
);

/** The player's repertoires shared with this coach, by name (checklist 1-2). */
export async function sharedWithCoach(
  db: Executor,
  coachId: string,
  playerId: string,
): Promise<SharedRepertoireItem[]> {
  return sharedRowsSchema.parse(
    await db
      .select({
        id: repertoires.id,
        name: repertoires.name,
        side: repertoires.side,
      })
      .from(repertoireShares)
      .innerJoin(repertoires, eq(repertoires.id, repertoireShares.repertoireId))
      .where(sharedTo(coachId, playerId))
      .orderBy(asc(repertoires.name), asc(repertoires.id)),
  );
}

/** The ids of the player's repertoires shared with this coach (for coachAccessFacts). */
export function sharedRepertoireIds(
  db: Executor,
  coachId: string,
  playerId: string,
): Promise<Set<string>> {
  return sharedIds(db, coachId, playerId);
}

/** A repertoire as its sharing coach sees it: read-only, with their own notes (R-125). */
export interface SharedRepertoire extends LoadedRepertoire {
  readonly notes: readonly CoachNote[];
}

/**
 * The player's repertoire `repertoireId` as the coach it is shared with
 * sees it, read in one snapshot: its graph with the move comments (R-102)
 * and the coach's own notes; never personal notes (checklist 2). Undefined
 * unless it is shared with this coach through an active link.
 */
export async function sharedRepertoireForCoach(
  db: Executor,
  coachId: string,
  playerId: string,
  repertoireId: string,
): Promise<SharedRepertoire | undefined> {
  if (!isUuid(repertoireId)) return undefined;
  return db.transaction(
    async (tx) => {
      const shared = tx
        .select({ id: repertoireShares.repertoireId })
        .from(repertoireShares)
        .where(
          and(
            sharedTo(coachId, playerId),
            eq(repertoireShares.repertoireId, repertoireId),
          ),
        );
      const loaded = await loadRepertoireRows(
        tx,
        inArray(repertoires.id, shared),
      );
      if (loaded === undefined) return undefined;
      return {
        ...loaded,
        notes: await coachOwnNotes(tx, coachId, repertoireId),
      };
    },
    { isolationLevel: 'repeatable read' },
  );
}

const ownShareRowsSchema = z.array(
  z.object({ repertoire: z.string(), coach: z.string(), sharedAt: z.date() }),
);

/**
 * The owner's shares (for the data export, R-106): each repertoire's name
 * and the coach's display name, by repertoire (oldest first), then coach.
 */
export async function sharesOfOwner(
  db: Executor,
  ownerId: string,
): Promise<z.infer<typeof ownShareRowsSchema>> {
  return ownShareRowsSchema.parse(
    await db
      .select({
        repertoire: repertoires.name,
        coach: accounts.displayName,
        sharedAt: repertoireShares.createdAt,
      })
      .from(repertoireShares)
      .innerJoin(repertoires, eq(repertoires.id, repertoireShares.repertoireId))
      .innerJoin(accounts, eq(accounts.id, repertoireShares.coachId))
      .where(eq(repertoireShares.playerId, ownerId))
      .orderBy(
        asc(repertoires.createdAt),
        asc(repertoires.id),
        asc(accounts.displayName),
        asc(repertoireShares.coachId),
      ),
  );
}
