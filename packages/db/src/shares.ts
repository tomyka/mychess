/**
 * A Player's own repertoires shared with linked coaches (R-42). The domain
 * decides (canShare, canCoachSee); every coach-facing query enforces it
 * again through the `shared` repertoireScope (repertoires/scope.ts), built
 * on sharedTo (share-scope.ts), the one share predicate: a share
 * counts only for this coach and this player, and only through an active
 * Coach link (checklist 1-3). Nothing here reads personal_notes
 * (checklist 2). The notes on a share are in coach-notes.ts.
 */
import { sideSchema } from '@mychess/chess';
import {
  sharedScope,
  canChangeShares,
  canShare,
  ok,
  refuse,
  SHARE_REFUSALS,
  type Result,
  type ShareRefusal,
} from '@mychess/domain';
import { and, asc, eq, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor, Tx } from './client';
import { holdLink } from './coach-queries';
import { coachOwnNotes, type CoachNote } from './coach-notes';
import { isUuid } from './ids';
import {
  loadRepertoireRows,
  type LoadedRepertoire,
} from './repertoires/repository';
import { repertoireScope } from './repertoires/scope';
import { accounts, repertoireShares, repertoires } from './schema';
import { holdRepertoireOwner, sharedIds } from './share-scope';

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
    if (ownerId === undefined) return refuse(SHARE_REFUSALS.notOwner);
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
    return ok();
  });
}

/** Who the owner wants a repertoire shared with: exactly these coaches. */
export interface SharesRequest {
  /** The account sharing: the session's, never one a client names. */
  readonly ownerId: string;
  readonly repertoireId: string;
  readonly coachIds: readonly string[];
  readonly now: Date;
}

/** What setShares came to: how many coaches it is shared with now. */
export interface SharesSet {
  readonly shared: number;
  /** The first coach refused (not linked), whom it is not shared with. */
  readonly refusal?: ShareRefusal;
}

/** Holds each coach's link to the owner, in id order; which are linked. */
async function holdLinks(
  tx: Tx,
  coachIds: readonly string[],
  ownerId: string,
): Promise<Set<string>> {
  const linked = new Set<string>();
  for (const coachId of coachIds)
    if (await holdLink(tx, coachId, ownerId)) linked.add(coachId);
  return linked;
}

/** Makes the owner's shares of a repertoire exactly `coachIds`. */
async function applyShares(
  tx: Tx,
  request: SharesRequest,
  coachIds: readonly string[],
): Promise<number> {
  const mine = and(
    eq(repertoireShares.repertoireId, request.repertoireId),
    eq(repertoireShares.playerId, request.ownerId),
  );
  await tx
    .delete(repertoireShares)
    .where(and(mine, notInArray(repertoireShares.coachId, [...coachIds])));
  if (coachIds.length > 0)
    await tx
      .insert(repertoireShares)
      .values(
        coachIds.map((coachId) => ({
          repertoireId: request.repertoireId,
          playerId: request.ownerId,
          coachId,
          createdAt: request.now,
        })),
      )
      .onConflictDoNothing();
  return tx.$count(repertoireShares, mine);
}

/**
 * Shares the owner's repertoire with exactly the coaches named, in one
 * transaction (R-42): the others' shares end, and their notes with them
 * (R-124). Someone else's repertoire is refused and nothing changes, even
 * with no coach named. Each coach is decided by canShare; one refused (not
 * linked) is left out and named in the outcome. The links and then the
 * repertoire are held, the order an unlink and an account delete take them.
 */
export async function setShares(
  db: Executor,
  request: SharesRequest,
): Promise<Result<SharesSet, ShareRefusal>> {
  const wanted = [...new Set(request.coachIds)].sort();
  return db.transaction(async (tx) => {
    const linked = await holdLinks(tx, wanted, request.ownerId);
    const ownerId = await holdRepertoireOwner(tx, request.repertoireId);
    if (ownerId === undefined) return refuse(SHARE_REFUSALS.notOwner);
    const owned = canChangeShares(request.ownerId, { ownerId });
    if (!owned.ok) return owned;
    const checks = wanted.map((coachId) => ({
      coachId,
      check: canShare(
        request.ownerId,
        { ownerId },
        coachId,
        linked.has(coachId),
      ),
    }));
    const allowed = checks.filter((c) => c.check.ok).map((c) => c.coachId);
    const shared = await applyShares(tx, request, allowed);
    const refused = checks.map((c) => c.check).find((check) => !check.ok);
    return ok(
      refused === undefined ? { shared } : { shared, refusal: refused.refusal },
    );
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
      .from(repertoires)
      .where(repertoireScope(db, sharedScope(coachId, playerId), 'view'))
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
export function sharedRepertoireForCoach(
  db: Executor,
  coachId: string,
  playerId: string,
  repertoireId: string,
): Promise<SharedRepertoire | undefined> {
  return db.transaction(
    (tx) => loadShared(tx, coachId, playerId, repertoireId),
    { isolationLevel: 'repeatable read' },
  );
}

/**
 * The shared repertoire and the coach's notes on it, read on `tx` (whose
 * snapshot the caller chose); undefined unless shared with this coach
 * through an active link, or the id is malformed.
 */
export async function loadShared(
  tx: Tx,
  coachId: string,
  playerId: string,
  repertoireId: string,
): Promise<SharedRepertoire | undefined> {
  if (!isUuid(repertoireId)) return undefined;
  const loaded = await loadRepertoireRows(
    tx,
    repertoireScope(tx, sharedScope(coachId, playerId), 'view', repertoireId),
  );
  if (loaded === undefined) return undefined;
  return { ...loaded, notes: await coachOwnNotes(tx, coachId, repertoireId) };
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
