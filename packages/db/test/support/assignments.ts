import { canUseAssignment } from '@mychess/domain';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '../../src';
import { assignments, forkOffers } from '../../src/assignment-schema';
import { assignmentFacts } from '../../src/assignments/reach';
import { graphOf, newRepertoire } from './repertoires';

/** A repertoire of `ownerId`, with a coach comment on 1. d4; returns its id. */
export function seedRepertoire(
  db: Db,
  ownerId: string,
  now: Date,
): Promise<string> {
  return newRepertoire(db, {
    ownerId,
    side: 'white',
    name: 'Londono sistema',
    graph: graphOf('1. d4 { Treneris: tvirtas centras } d5 2. Bf4 Nf6 *'),
    now,
  });
}

/** An assignment row written directly, bypassing assign; returns its id. */
export async function seedAssignment(
  db: Db,
  row: {
    readonly coachId: string;
    readonly repertoireId: string;
    readonly target: { playerId: string } | { groupId: string };
    readonly now: Date;
  },
): Promise<string> {
  const [inserted] = await db
    .insert(assignments)
    .values({
      coachId: row.coachId,
      repertoireId: row.repertoireId,
      assignedVersion: 1,
      createdAt: row.now,
      ...row.target,
    })
    .returning({ id: assignments.id });
  return z.uuid().parse(inserted?.id);
}

export interface OfferRow {
  readonly playerId: string;
  readonly repertoireId: string | null;
  readonly reason: string;
  readonly closedAt: Date | null;
}

/** Every fork offer, by player then creation: who, for what, why, closed when. */
export const offersOf = (db: Db): Promise<OfferRow[]> =>
  db
    .select({
      playerId: forkOffers.playerId,
      repertoireId: forkOffers.repertoireId,
      reason: forkOffers.reason,
      closedAt: forkOffers.closedAt,
    })
    .from(forkOffers)
    .orderBy(asc(forkOffers.playerId), asc(forkOffers.createdAt));

/** The ids of the repertoires `playerId` has live (canUseAssignment). */
export async function liveRepertoireIds(
  db: Db,
  playerId: string,
): Promise<Set<string>> {
  const facts = await assignmentFacts(db, { playerIds: [playerId] });
  return new Set(
    facts
      .filter((one) => canUseAssignment(one).ok)
      .map((one) => one.repertoireId),
  );
}
