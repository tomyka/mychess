import {
  assignedScope as assigned,
  ownScope as own,
  sharedScope as shared,
  type RepertoirePurpose,
  type RepertoireScope,
} from '@mychess/domain';
import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { shareRepertoire, unlink } from '../src';
import { assignmentPlayers } from '../src/assignment-schema';
import { repertoireScope } from '../src/repertoires/scope';
import { repertoires } from '../src/schema';
import { useTestDatabase } from '../src/testing';
import { seedAssignment, seedRepertoire } from './support/assignments';
import {
  seedCoach,
  seedGroup,
  seedLink,
  seedMember,
  seedPlayer,
  T0,
} from './support/coaching';

const { db } = useTestDatabase();

/**
 * Rimantas coaches Gabija, Rokas and Fausta, and assigned them his London;
 * Fausta forked it. Dovydas coaches Gabija too. Gabija shares her Taimanov
 * with Rimantas only. Eglė coaches nobody; Simas is linked to no one.
 */
let london = '';
let taimanov = '';
let gabijaOther = '';

beforeEach(async () => {
  for (const coach of ['rimantas', 'dovydas', 'egle'])
    await seedCoach(db, coach, `${coach}@example.lt`);
  for (const player of ['gabija', 'rokas', 'fausta', 'simas'])
    await seedPlayer(db, player, `${player}@example.lt`);
  for (const player of ['gabija', 'rokas', 'fausta'])
    await seedLink(db, 'rimantas', player);
  await seedLink(db, 'dovydas', 'gabija');
  london = await seedRepertoire(db, 'rimantas', T0);
  taimanov = await seedRepertoire(db, 'gabija', T0);
  gabijaOther = await seedRepertoire(db, 'gabija', T0);
  for (const playerId of ['rokas', 'fausta'])
    await seedAssignment(db, {
      coachId: 'rimantas',
      repertoireId: london,
      target: { playerId },
      now: T0,
    });
  await db
    .insert(assignmentPlayers)
    .values({ playerId: 'fausta', repertoireId: london, forkedAt: T0 });
  await shareRepertoire(db, {
    ownerId: 'gabija',
    repertoireId: taimanov,
    coachId: 'rimantas',
    now: T0,
  });
});

/** The ids of the repertoires the scope's filter selects, by id. */
async function selected(
  scope: RepertoireScope,
  purpose: RepertoirePurpose,
  repertoireId?: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: repertoires.id })
    .from(repertoires)
    .where(repertoireScope(db, scope, purpose, repertoireId))
    .orderBy(asc(repertoires.id));
  return rows.map((row) => row.id);
}

const sorted = (...ids: string[]) => [...ids].sort();

describe('repertoireScope: own', () => {
  it("selects the owner's repertoires, for viewing and editing", async () => {
    expect(await selected(own('gabija'), 'view')).toEqual(
      sorted(taimanov, gabijaOther),
    );
    expect(await selected(own('gabija'), 'edit', taimanov)).toEqual([taimanov]);
  });

  it('selects nothing of anyone else', async () => {
    for (const id of ['rimantas', 'rokas', 'simas', 'egle'])
      expect(await selected(own(id), 'view', taimanov)).toEqual([]);
  });

  it("lets no one edit someone else's repertoire by its id", async () => {
    expect(await selected(own('rimantas'), 'edit', taimanov)).toEqual([]);
  });
});

describe('repertoireScope: shared', () => {
  it('selects what the player shared with this coach', async () => {
    expect(await selected(shared('rimantas', 'gabija'), 'view')).toEqual([
      taimanov,
    ]);
    expect(
      await selected(shared('rimantas', 'gabija'), 'view', taimanov),
    ).toEqual([taimanov]);
  });

  it('selects nothing for a linked coach it is not shared with, an unlinked coach or a stranger', async () => {
    for (const coachId of ['dovydas', 'egle', 'simas'])
      expect(await selected(shared(coachId, 'gabija'), 'view')).toEqual([]);
  });

  it('selects nothing of a repertoire the player did not share, asked for by its id', async () => {
    expect(
      await selected(shared('rimantas', 'gabija'), 'view', gabijaOther),
    ).toEqual([]);
  });

  it("selects nothing of another player's repertoires", async () => {
    expect(await selected(shared('rimantas', 'rokas'), 'view')).toEqual([]);
    expect(
      await selected(shared('rimantas', 'rokas'), 'view', taimanov),
    ).toEqual([]);
  });

  it('selects nothing once the coach is unlinked', async () => {
    await unlink(db, 'rimantas', 'gabija', T0);
    expect(await selected(shared('rimantas', 'gabija'), 'view')).toEqual([]);
  });
});

describe('repertoireScope: assigned', () => {
  it('selects a repertoire live for the player', async () => {
    expect(await selected(assigned('rokas'), 'view')).toEqual([london]);
    expect(await selected(assigned('rokas'), 'view', london)).toEqual([london]);
  });

  it('selects nothing for a forked player, an unassigned one or a stranger', async () => {
    for (const playerId of ['fausta', 'gabija', 'simas', 'rimantas'])
      expect(await selected(assigned(playerId), 'view', london)).toEqual([]);
  });

  it('selects nothing, with no id named, for a forked player, an unassigned one or the coach', async () => {
    for (const playerId of ['fausta', 'gabija', 'rimantas'])
      expect(await selected(assigned(playerId), 'view')).toEqual([]);
  });

  it('selects a repertoire assigned to a group the player is in', async () => {
    const group = await seedGroup(db, 'rimantas', 'Juniors');
    await seedMember(db, 'rimantas', group, 'gabija');
    await seedAssignment(db, {
      coachId: 'rimantas',
      repertoireId: london,
      target: { groupId: group },
      now: T0,
    });
    expect(await selected(assigned('gabija'), 'view')).toEqual([london]);
    expect(await selected(assigned('gabija'), 'view', london)).toEqual([
      london,
    ]);
  });
});

describe('repertoireScope: edit is the owner only (canUseScope)', () => {
  it('selects nothing through a share or an assignment', async () => {
    expect(
      await selected(shared('rimantas', 'gabija'), 'edit', taimanov),
    ).toEqual([]);
    expect(await selected(assigned('rokas'), 'edit', london)).toEqual([]);
  });
});
