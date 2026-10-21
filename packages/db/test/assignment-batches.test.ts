import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unassign } from '../src';
import { assignmentPlayers } from '../src/assignment-schema';
import type * as Batch from '../src/assignments/batch';
import { inPairs } from '../src/assignments/pairs';
import { useTestDatabase } from '../src/testing';
import {
  offersOf,
  seedAssignment,
  seedRepertoire,
} from './support/assignments';
import {
  seedCoach,
  seedGroup,
  seedLink,
  seedMember,
  seedPlayer,
} from './support/coaching';
import { countStatements } from './support/statements';

// A two-offer chunk, so a batch of five spans three inserts.
vi.mock('../src/assignments/batch', async (importOriginal) => ({
  ...(await importOriginal<typeof Batch>()),
  FORK_OFFER_CHUNK: 2,
}));

const { db } = useTestDatabase();

const NOW = new Date('2026-10-20T09:00:00Z');
const LATER = new Date('2026-10-21T09:00:00Z');
/** Above Postgres's 65,535 bind parameters at two per pair. */
const MANY_PAIRS = 40_000;

let rep = '';

beforeEach(async () => {
  await seedCoach(db, 'c', 'c@example.lt');
  rep = await seedRepertoire(db, 'c', NOW);
});

/** A group of `size` new linked players, assigned `rep`; returns the row id. */
async function assignedGroup(name: string, size: number): Promise<string> {
  const groupId = await seedGroup(db, 'c', `Grupė ${name}`);
  for (let i = 1; i <= size; i += 1) {
    const playerId = `${name}-${String(i)}`;
    await seedPlayer(db, playerId, `${playerId}@example.lt`);
    await seedLink(db, 'c', playerId);
    await seedMember(db, 'c', groupId, playerId);
  }
  return seedAssignment(db, {
    coachId: 'c',
    repertoireId: rep,
    target: { groupId },
    now: NOW,
  });
}

describe('a change above one fork-offer chunk', () => {
  it('offers every player, one insert per chunk', async () => {
    const one = await assignedGroup('a', 1);
    const five = await assignedGroup('b', 5);
    const forOne = await countStatements(() =>
      unassign(db, { coachId: 'c', assignmentId: one }, LATER),
    );
    const forFive = await countStatements(() =>
      unassign(db, { coachId: 'c', assignmentId: five }, LATER),
    );
    expect(forFive - forOne).toBe(2);
    expect(await offersOf(db)).toEqual(
      ['a-1', 'b-1', 'b-2', 'b-3', 'b-4', 'b-5'].map((playerId) => ({
        playerId,
        repertoireId: rep,
        reason: 'unassigned',
        closedAt: null,
      })),
    );
  });
});

describe('inPairs above the bind-parameter ceiling', () => {
  it('finds the rows of a batch of pairs in one statement', async () => {
    await seedPlayer(db, 'p', 'p@example.lt');
    await db
      .insert(assignmentPlayers)
      .values({ playerId: 'p', repertoireId: rep, seenVersion: 1 });
    const pairs = [
      ...Array.from({ length: MANY_PAIRS }, (_, i) => ({
        playerId: `x${String(i)}`,
        repertoireId: randomUUID(),
      })),
      { playerId: 'p', repertoireId: rep },
    ];
    let found: unknown[] = [];
    const sent = await countStatements(async () => {
      found = await db
        .select({
          playerId: assignmentPlayers.playerId,
          repertoireId: assignmentPlayers.repertoireId,
        })
        .from(assignmentPlayers)
        .where(
          inPairs(
            assignmentPlayers.playerId,
            assignmentPlayers.repertoireId,
            pairs,
          ),
        );
    });
    expect(sent).toBe(1);
    expect(found).toEqual([{ playerId: 'p', repertoireId: rep }]);
  });

  it('finds no row for no pairs', async () => {
    await seedPlayer(db, 'p', 'p@example.lt');
    await db
      .insert(assignmentPlayers)
      .values({ playerId: 'p', repertoireId: rep });
    expect(
      await db
        .select()
        .from(assignmentPlayers)
        .where(
          inPairs(
            assignmentPlayers.playerId,
            assignmentPlayers.repertoireId,
            [],
          ),
        ),
    ).toEqual([]);
  });
});
