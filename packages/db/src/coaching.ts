import {
  canStopCoaching,
  COACH_REFUSALS,
  type CoachAccessFacts,
  type CoachRefusal,
  type Result,
} from '@mychess/domain';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { lockAccountById } from './accounts';
import type { Db, Executor } from './client';
import { isLinked, linkCount } from './coach-queries';
import { revokeOpenInvites } from './invites';
import { DONE, refusal } from './results';
import { accounts, coachLinks, groupMembers, groups } from './schema';

/** Switches Coach mode on (R-11); a second call keeps the first time. */
export async function startCoaching(
  db: Executor,
  id: string,
  now: Date,
): Promise<void> {
  await db
    .update(accounts)
    .set({
      coachSince: sql`coalesce(${accounts.coachSince}, ${now})`,
      updatedAt: now,
    })
    .where(eq(accounts.id, id));
}

/**
 * Switches Coach mode off unless a player is linked (R-100), and revokes
 * the coach's open invites in the same transaction; groups stay (R-109).
 * Locks the coach row first, the lock order acceptInvite documents (plan
 * decision 1): a racing accept or createInvite either lands first (an
 * accept then refuses the stop; a new invite is revoked with the rest) or
 * runs after it, finding its invite revoked or Coach mode off.
 */
export function stopCoaching(
  db: Db,
  coachId: string,
  now: Date,
): Promise<Result<undefined, CoachRefusal>> {
  return db.transaction(async (tx) => {
    const coach = await lockAccountById(tx, coachId);
    if (coach === undefined) return refusal(COACH_REFUSALS.notCoach);
    const check = canStopCoaching(await linkCount(tx, coachId));
    if (!check.ok) return check;
    await revokeOpenInvites(tx, coachId, now);
    await tx
      .update(accounts)
      .set({ coachSince: null, updatedAt: now })
      .where(eq(accounts.id, coachId));
    return DONE;
  });
}

/** A group named on a link, as either side sees it. */
export interface GroupRef {
  readonly id: string;
  readonly name: string;
}

/**
 * The account on the other side of a Coach link: a coach's player
 * (coachPlayers) or a player's coach (playerCoaches), with the groups of
 * that coach the player is in.
 */
export interface LinkedAccount {
  readonly id: string;
  readonly displayName: string;
  readonly linkedAt: Date;
  readonly groups: readonly GroupRef[];
}

const linkRowsSchema = z.array(
  z.object({
    id: z.string().min(1),
    displayName: z.string(),
    linkedAt: z.date(),
  }),
);

const membershipRowsSchema = z.array(
  z.object({ owner: z.string().min(1), id: z.uuid(), name: z.string() }),
);

/** Which end of the link a listing is for. */
interface LinkEnd {
  /** The link column naming the account listed. */
  readonly other: PgColumn;
  /** The membership column naming the account listed. */
  readonly memberOther: PgColumn;
}

const PLAYER_END: LinkEnd = {
  other: coachLinks.playerId,
  memberOther: groupMembers.playerId,
};
const COACH_END: LinkEnd = {
  other: coachLinks.coachId,
  memberOther: groupMembers.coachId,
};

/** The linked accounts at `end` where `links` and `members` hold. */
async function linkedAccounts(
  db: Executor,
  end: LinkEnd,
  where: { readonly links: SQL | undefined; readonly members: SQL | undefined },
): Promise<LinkedAccount[]> {
  const people = linkRowsSchema.parse(
    await db
      .select({
        id: accounts.id,
        displayName: accounts.displayName,
        linkedAt: coachLinks.createdAt,
      })
      .from(coachLinks)
      .innerJoin(accounts, eq(accounts.id, end.other))
      .where(where.links)
      .orderBy(accounts.displayName, accounts.id),
  );
  const memberships = membershipRowsSchema.parse(
    await db
      .select({ owner: end.memberOther, id: groups.id, name: groups.name })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(where.members)
      .orderBy(groups.name, groups.id),
  );
  return people.map((person) => ({
    ...person,
    groups: memberships
      .filter((membership) => membership.owner === person.id)
      .map(({ id, name }) => ({ id, name })),
  }));
}

/** The coach's linked players by display name, with the coach's groups. */
export function coachPlayers(
  db: Executor,
  coachId: string,
): Promise<LinkedAccount[]> {
  return linkedAccounts(db, PLAYER_END, {
    links: eq(coachLinks.coachId, coachId),
    members: eq(groupMembers.coachId, coachId),
  });
}

/** One player linked to the coach, or undefined when they are not linked. */
export async function coachPlayer(
  db: Executor,
  coachId: string,
  playerId: string,
): Promise<LinkedAccount | undefined> {
  const [player] = await linkedAccounts(db, PLAYER_END, {
    links: and(
      eq(coachLinks.coachId, coachId),
      eq(coachLinks.playerId, playerId),
    ),
    members: and(
      eq(groupMembers.coachId, coachId),
      eq(groupMembers.playerId, playerId),
    ),
  });
  return player;
}

/** The player's coaches by display name, with the player's groups of each. */
export function playerCoaches(
  db: Executor,
  playerId: string,
): Promise<LinkedAccount[]> {
  return linkedAccounts(db, COACH_END, {
    links: eq(coachLinks.playerId, playerId),
    members: eq(groupMembers.playerId, playerId),
  });
}

/**
 * Ends a Coach link, from either side (spec, lead decision). The foreign
 * keys onto coach_links remove the coach's group memberships (and, from
 * Part B, shares) for this player in the same statement (plan decision 2).
 */
export async function unlink(
  db: Executor,
  coachId: string,
  playerId: string,
): Promise<Result<undefined, CoachRefusal>> {
  const removed = await db
    .delete(coachLinks)
    .where(
      and(eq(coachLinks.coachId, coachId), eq(coachLinks.playerId, playerId)),
    )
    .returning({ playerId: coachLinks.playerId });
  return removed.length === 1 ? DONE : refusal(COACH_REFUSALS.notLinked);
}

/** The facts canCoachSee decides on, read fresh on every request (checklist 3). */
export async function coachAccessFacts(
  db: Executor,
  coachId: string,
  playerId: string,
): Promise<CoachAccessFacts> {
  // Part B (Task B4) fills the shares from repertoire_shares.
  return {
    linked: await isLinked(db, coachId, playerId),
    sharedRepertoireIds: new Set<string>(),
  };
}
