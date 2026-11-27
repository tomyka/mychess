import { playerKeys, standingOf, startReview } from '@mychess/chess';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  coachAssigneeStandings,
  coachRepertoireProgress,
  forkAssignment,
  pauseAssignment,
  shareRepertoire,
  unlink,
} from '../src';
import { graphRows } from '../src/repertoires/repository';
import { useTestDatabase } from '../src/testing';
import { seedAssignment, seedRepertoire } from './support/assignments';
import {
  seedCoach,
  seedGroup,
  seedLink,
  seedMember,
  seedPlayer,
} from './support/coaching';
import { countStatements, statementsOf } from './support/statements';
import { writeReview } from './support/training';

const { db } = useTestDatabase();
const NOW = new Date('2026-10-26T09:00:00Z');
const WEEK_AGO = new Date(NOW.getTime() - 7 * 86_400_000);

let karoKan = ''; // the coach's, assigned to p individually
let group = '';
let groupRep = ''; // the coach's, assigned to the group of p and q
let shared = ''; // p's own, shared with c
let privateRep = ''; // p's own, not shared

/** A setup step that must not be refused. */
function succeeded(
  done: { ok: true } | { ok: false; refusal: { reason: string } },
): void {
  if (!done.ok) throw new Error(done.refusal.reason);
}

beforeEach(async () => {
  await seedCoach(db, 'c', 'c@example.lt');
  await seedCoach(db, 'other', 'other@example.lt');
  await seedPlayer(db, 'p', 'p@example.lt');
  await seedPlayer(db, 'q', 'q@example.lt');
  await seedPlayer(db, 'stranger', 's@example.lt');
  await seedLink(db, 'c', 'p');
  await seedLink(db, 'c', 'q');
  karoKan = await seedRepertoire(db, 'c', NOW);
  groupRep = await seedRepertoire(db, 'c', NOW);
  shared = await seedRepertoire(db, 'p', NOW);
  privateRep = await seedRepertoire(db, 'p', NOW);
  group = await seedGroup(db, 'c', 'Šeštadienio grupė');
  await seedMember(db, 'c', group, 'p');
  await seedMember(db, 'c', group, 'q');
  await seedAssignment(db, {
    coachId: 'c',
    repertoireId: karoKan,
    target: { playerId: 'p' },
    now: NOW,
  });
  await seedAssignment(db, {
    coachId: 'c',
    repertoireId: groupRep,
    target: { groupId: group },
    now: NOW,
  });
  succeeded(
    await shareRepertoire(db, {
      ownerId: 'p',
      repertoireId: shared,
      coachId: 'c',
      now: NOW,
    }),
  );
});

/** `playerId` learned every player move of `repertoireId` a week ago; all due now. */
async function learnAll(
  playerId: string,
  repertoireId: string,
): Promise<number> {
  const keys = playerKeys(await graphRows(db, repertoireId, 'white'));
  for (const key of keys)
    await writeReview(db, playerId, startReview(key, WEEK_AGO), {
      learnedAt: WEEK_AGO,
    });
  return keys.length;
}

/** The batched read of `playerIds` on `repertoireId`, as coach `coachId`. */
const batched = (
  repertoireId: string,
  playerIds: readonly string[],
  coachId = 'c',
) => coachAssigneeStandings(db, { coachId, repertoireId, playerIds }, NOW);

/**
 * What the progress page's read shows of one player, as a standing and
 * status, or null.
 */
async function perPlayer(
  repertoireId: string,
  playerId: string,
  coachId = 'c',
) {
  const view = await coachRepertoireProgress(
    db,
    { coachId, playerId, repertoireId },
    NOW,
  );
  return view === undefined
    ? null
    : { standing: standingOf(view.progress), status: view.status };
}

/** The per-player read of each of `playerIds`, as the batched read's map. */
async function perPlayerOf(
  repertoireId: string,
  playerIds: readonly string[],
  coachId = 'c',
) {
  const out = new Map<string, Awaited<ReturnType<typeof perPlayer>>>();
  for (const id of playerIds)
    out.set(id, await perPlayer(repertoireId, id, coachId));
  return out;
}

describe('coachAssigneeStandings', () => {
  it('gives a linked player with progress the progress page’s standing', async () => {
    const own = await learnAll('p', karoKan);
    const read = await batched(karoKan, ['p']);
    expect(read).toEqual(await perPlayerOf(karoKan, ['p']));
    expect(read.get('p')?.standing).toEqual({
      counts: { notStarted: 0, skipped: 0, due: own, learned: 0 },
      mastered: false,
    });
  });

  it('gives each player their assignment’s status, done once every move is tracked (R-129)', async () => {
    await learnAll('p', karoKan);
    const read = await batched(karoKan, ['p']);
    expect(read).toEqual(await perPlayerOf(karoKan, ['p']));
    expect(read.get('p')?.status).toEqual({
      deadline: null,
      overdue: false,
      paused: false,
      done: true,
      forked: false,
    });
  });

  it('says overdue past the deadline and paused while paused', async () => {
    const late = await seedRepertoire(db, 'c', NOW);
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: late,
      target: { groupId: group },
      now: NOW,
      deadline: '2026-10-20',
    });
    succeeded(
      await pauseAssignment(
        db,
        { playerId: 'q', repertoireId: late, paused: true },
        NOW,
      ),
    );
    const read = await batched(late, ['p', 'q']);
    expect(read).toEqual(await perPlayerOf(late, ['p', 'q']));
    const still = { done: false, forked: false, deadline: '2026-10-20' };
    expect(read.get('p')?.status).toEqual({
      ...still,
      overdue: true,
      paused: false,
    });
    expect(read.get('q')?.status).toEqual({
      ...still,
      overdue: true,
      paused: true,
    });
  });

  it('gives every player a group assignment reaches their own standing', async () => {
    const own = await learnAll('q', groupRep);
    const read = await batched(groupRep, ['p', 'q']);
    expect(read).toEqual(await perPlayerOf(groupRep, ['p', 'q']));
    expect(read.get('p')?.standing.counts).toMatchObject({
      notStarted: own,
      due: 0,
    });
    expect(read.get('q')?.standing.counts).toMatchObject({
      notStarted: 0,
      due: own,
    });
  });

  it('gives a player once unlinked no standing', async () => {
    await learnAll('p', groupRep);
    succeeded(await unlink(db, 'c', 'p', NOW));
    const read = await batched(groupRep, ['p', 'q']);
    expect(read).toEqual(await perPlayerOf(groupRep, ['p', 'q']));
    expect(read.get('p')).toBeNull();
    expect(read.get('q')).not.toBeNull();
  });

  it('gives a forked assignment no standing (R-155)', async () => {
    await learnAll('q', groupRep);
    succeeded(
      await forkAssignment(db, { playerId: 'q', repertoireId: groupRep }, NOW),
    );
    const read = await batched(groupRep, ['p', 'q']);
    expect(read).toEqual(await perPlayerOf(groupRep, ['p', 'q']));
    expect(read.get('q')).toBeNull();
    expect(read.get('p')).not.toBeNull();
  });

  it('leaks nothing of a player the coach has no link to', async () => {
    await seedLink(db, 'other', 'stranger');
    await learnAll('stranger', karoKan);
    const read = await batched(karoKan, ['stranger', 'p', 'c']);
    expect(read).toEqual(await perPlayerOf(karoKan, ['stranger', 'p', 'c']));
    expect(read.get('stranger')).toBeNull();
    // The coach's own id is no player of theirs.
    expect(read.get('c')).toBeNull();
    expect(read.get('p')).not.toBeNull();
  });

  it('gives nothing to another coach, even one linked to the player', async () => {
    await seedLink(db, 'other', 'p');
    await learnAll('p', karoKan);
    const read = await batched(karoKan, ['p'], 'other');
    expect(read).toEqual(await perPlayerOf(karoKan, ['p'], 'other'));
    expect(read.get('p')).toBeNull();
  });

  it('reads a repertoire the player shares through the share, a private one not at all', async () => {
    const own = await learnAll('p', shared);
    const read = await batched(shared, ['p', 'q']);
    expect(read).toEqual(await perPlayerOf(shared, ['p', 'q']));
    expect(read.get('p')?.standing.counts.due).toBe(own);
    // A shared repertoire is no assignment: no status.
    expect(read.get('p')?.status).toBeNull();
    expect(read.get('q')).toBeNull();
    expect(await batched(privateRep, ['p'])).toEqual(new Map([['p', null]]));
  });

  it('gives every player null for a malformed repertoire id, reading nothing', async () => {
    expect(await countStatements(() => batched('nope', ['p', 'q']))).toBe(0);
    expect(await batched('nope', ['p', 'q'])).toEqual(
      new Map([
        ['p', null],
        ['q', null],
      ]),
    );
  });

  it('reads nothing for no players', async () => {
    expect(await countStatements(() => batched(groupRep, []))).toBe(0);
    expect(await batched(groupRep, [])).toEqual(new Map());
  });

  it('reads in one transaction whatever the number of players', async () => {
    const begins = async (playerIds: readonly string[]) =>
      (await statementsOf(() => batched(groupRep, playerIds))).filter((s) =>
        /^begin/i.test(s),
      ).length;
    expect(await begins(['p'])).toBe(1);
    expect(await begins(['p', 'q', 'stranger'])).toBe(1);
  });

  it('loads the graph once: its statements do not grow with players', async () => {
    const one = await countStatements(() => batched(groupRep, ['p']));
    await seedPlayer(db, 'r', 'r@example.lt');
    await seedLink(db, 'c', 'r');
    await seedMember(db, 'c', group, 'r');
    const three = await countStatements(() =>
      batched(groupRep, ['p', 'q', 'r']),
    );
    expect(three).toBe(one);
  });
});
