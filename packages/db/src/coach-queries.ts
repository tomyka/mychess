// Reads the coaching repositories share. Internal to the package.
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor, Tx } from './client';
import { isUuid } from './ids';
import { coachLinks, groups } from './schema';

/** A row count as `$count` returns it. */
export const countSchema = z.number().int().nonnegative();

/** Player ids as a `select({ playerId })` returns them. */
export const playerRowsSchema = z.array(
  z.object({ playerId: z.string().min(1) }),
);

/**
 * Is `groupId` a group of `coachId`? If so, the group row is held (FOR KEY
 * SHARE) for the rest of `tx`: a deleteGroup waits until `tx` ends, and
 * one that came first leaves the group not found here, rather than failing
 * a later insert on its foreign key.
 */
export async function holdGroup(
  tx: Tx,
  coachId: string,
  groupId: string,
): Promise<boolean> {
  if (!isUuid(groupId)) return false;
  const rows = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.coachId, coachId)))
    .for('key share');
  return rows.length === 1;
}

/** How many groups `coachId` has. */
export async function groupCount(
  db: Executor,
  coachId: string,
): Promise<number> {
  return countSchema.parse(
    await db.$count(groups, eq(groups.coachId, coachId)),
  );
}

/** How many players `coachId` is linked to. */
export async function linkCount(
  db: Executor,
  coachId: string,
): Promise<number> {
  return countSchema.parse(
    await db.$count(coachLinks, eq(coachLinks.coachId, coachId)),
  );
}

const linkIs = (coachId: string, playerId: string) =>
  and(eq(coachLinks.coachId, coachId), eq(coachLinks.playerId, playerId));

/** Is there a Coach link from `coachId` to `playerId` now? */
export async function isLinked(
  db: Executor,
  coachId: string,
  playerId: string,
): Promise<boolean> {
  return (
    countSchema.parse(await db.$count(coachLinks, linkIs(coachId, playerId))) >
    0
  );
}

/**
 * Is the pair linked? If so, the link row is held (FOR KEY SHARE) for the
 * rest of `tx`, so an unlink waits until `tx` ends instead of removing the
 * link under a row that references it.
 */
export async function holdLink(
  tx: Tx,
  coachId: string,
  playerId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ playerId: coachLinks.playerId })
    .from(coachLinks)
    .where(linkIs(coachId, playerId))
    .for('key share');
  return rows.length === 1;
}
