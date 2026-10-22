import {
  fenOf,
  moveKey,
  START_KEY,
  type RepertoireGraph,
} from '@mychess/chess';
import { forkOfferExpiry } from '@mychess/domain';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  acceptForkOffer,
  assign,
  createRepertoire,
  declineForkOffer,
  deleteAccount,
  deleteRepertoire,
  editRepertoire,
  exportAccount,
  forkAssignment,
  forkCoachNotesOn,
  listPersonalNotes,
  loadRepertoire,
  openForkOffers,
  pauseAssignment,
  playerAssignments,
  setPersonalNote,
  trainingRepertoires,
  unassign,
} from '../src';
import { assignments } from '../src/assignment-schema';
import { forkForDeletingCoach } from '../src/assignments/coach-delete';
import { repertoires } from '../src/schema';
import { useTestDatabase } from '../src/testing';
import {
  openTransaction,
  seedCoach,
  seedGroup,
  seedLink,
  seedMember,
  seedPlayer,
  someoneWaitsForALock,
} from './support/coaching';
import { canonical, graphOf } from './support/repertoires';
import { countStatements } from './support/statements';

const { db, client } = useTestDatabase();

const NOW = new Date('2026-10-20T09:00:00Z');
const LATER = new Date('2026-10-21T09:00:00Z');
/** R: the coach's comment on 1. d4; the player moves are d4 and Bf4. */
const PGN = '1. d4 { Treneris: tvirtas centras } d5 2. Bf4 Nf6 *';
const COMMENT = 'Treneris: tvirtas centras';
const D4 = moveKey(START_KEY, 'd4');
const OK = { ok: true, value: undefined };
const NOT_FOUND = { ok: false, refusal: { reason: 'assignment.notFound' } };
const NOT_OPEN = { ok: false, refusal: { reason: 'forkOffer.notOpen' } };

const query = async (
  text: string,
  params: unknown[] = [],
): Promise<unknown[]> =>
  (await client.query<Record<string, unknown>>(text, params)).rows;

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

let rep = '';
let g = '';

const toPlayer = (playerId: string) => ({ kind: 'player', playerId }) as const;
const toGroup = (groupId: string) => ({ kind: 'group', groupId }) as const;

async function assignTo(
  target: ReturnType<typeof toPlayer> | ReturnType<typeof toGroup>,
): Promise<void> {
  expect(
    await assign(
      db,
      { coachId: 'c', repertoireId: rep, target, deadline: null },
      NOW,
    ),
  ).toEqual(OK);
}

async function note(playerId: string, text: string): Promise<void> {
  expect(
    await setPersonalNote(db, {
      playerId,
      repertoireId: rep,
      moveKey: D4,
      text,
      now: NOW,
    }),
  ).toEqual(OK);
}

/** `graph` as a fork holds it: every comment gone (plan decision 7). */
const uncommented = (graph: RepertoireGraph): RepertoireGraph => ({
  ...graph,
  moves: graph.moves.map((m) => ({ ...m, comment: null })),
});

const coachGraph = async (): Promise<RepertoireGraph> =>
  must(await loadRepertoire(db, rep, 'c')).graph;

/** The ids of the repertoires `ownerId` owns, oldest first. */
const ownedIds = async (ownerId: string): Promise<string[]> =>
  (
    await db
      .select({ id: repertoires.id })
      .from(repertoires)
      .where(eq(repertoires.ownerAccountId, ownerId))
      .orderBy(asc(repertoires.createdAt), asc(repertoires.id))
  ).map((row) => row.id);

const forkedAt = (playerId: string) =>
  query(
    'select forked_at from assignment_players where player_id = $1 and repertoire_id = $2',
    [playerId, rep],
  );

async function fork(playerId: string): Promise<string> {
  const forked = await forkAssignment(
    db,
    { playerId, repertoireId: rep },
    LATER,
  );
  if (!forked.ok) throw new Error(forked.refusal.reason);
  return forked.value.forkId;
}

/** The id of `playerId`'s one open offer. */
async function offerOf(playerId: string, now = NOW): Promise<string> {
  const [offer] = await openForkOffers(db, playerId, now);
  return must(offer).id;
}

const offerRows = () =>
  query(
    'select player_id, accepted_at, declined_at, fork_id from fork_offers order by player_id',
  );

beforeEach(async () => {
  await seedCoach(db, 'c', 'c@example.lt');
  for (const id of ['p', 'q', 'n']) {
    await seedPlayer(db, id, `${id}@example.lt`);
    await seedLink(db, 'c', id);
  }
  g = await seedGroup(db, 'c', 'Šeštadienio grupė');
  await seedMember(db, 'c', g, 'p');
  await seedMember(db, 'c', g, 'q');
  rep = await createRepertoire(db, {
    ownerId: 'c',
    side: 'white',
    name: 'Londono sistema',
    graph: graphOf(PGN),
    now: NOW,
  });
});

describe('forkAssignment', () => {
  it("makes the player's own copy: same moves, comments as coach notes, their notes, never another's (R-43, R-47)", async () => {
    await assignTo(toGroup(g));
    await note('p', 'Mano pastaba');
    await note('q', 'Kito pastaba');
    const source = await loadRepertoire(db, rep, 'c');
    const forkId = await fork('p');
    const forked = must(await loadRepertoire(db, forkId, 'p'));
    expect(forked.repertoire).toMatchObject({
      ownerId: 'p',
      name: 'Londono sistema',
      side: 'white',
    });
    expect(canonical(forked.graph)).toEqual(
      canonical(uncommented(await coachGraph())),
    );
    expect(await forkCoachNotesOn(db, 'p', forkId)).toEqual([
      { moveKey: D4, text: COMMENT, coachName: 'Name c' },
    ]);
    expect(await listPersonalNotes(db, 'p', forkId)).toEqual({
      [D4]: 'Mano pastaba',
    });
    expect(await loadRepertoire(db, rep, 'c')).toEqual(source);
  });

  it('replaces the live assignment for that player only (R-128)', async () => {
    await assignTo(toGroup(g));
    const forkId = await fork('p');
    expect(await forkedAt('p')).toEqual([{ forked_at: LATER }]);
    expect(await playerAssignments(db, 'p', NOW)).toEqual([]);
    expect(
      (await trainingRepertoires(db, 'p')).map((r) => [r.id, r.active]),
    ).toEqual([[forkId, true]]);
    expect(await playerAssignments(db, 'q', NOW)).toMatchObject([
      { repertoireId: rep },
    ]);
  });

  it('forks an individual assignment too', async () => {
    await assignTo(toPlayer('n'));
    const forkId = await fork('n');
    expect(await ownedIds('n')).toEqual([forkId]);
  });

  it('refuses forking again, and writes nothing', async () => {
    await assignTo(toGroup(g));
    const forkId = await fork('p');
    expect(
      await forkAssignment(db, { playerId: 'p', repertoireId: rep }, LATER),
    ).toEqual(NOT_FOUND);
    expect(await ownedIds('p')).toEqual([forkId]);
  });

  it.each([
    ['a repertoire not assigned to the player', 'n', () => rep],
    ['a malformed id', 'p', () => 'not-a-uuid'],
    [
      'an unknown repertoire',
      'p',
      () => '00000000-0000-4000-8000-000000000000',
    ],
    ["the coach's own repertoire", 'c', () => rep],
  ])('refuses %s as not found, and writes nothing', async (_, playerId, id) => {
    await assignTo(toGroup(g));
    expect(
      await forkAssignment(db, { playerId, repertoireId: id() }, LATER),
    ).toEqual(NOT_FOUND);
    expect(await ownedIds(playerId)).toEqual(playerId === 'c' ? [rep] : []);
    expect(await query('select * from assignment_players')).toEqual([]);
  });

  it('waits for the coach row, so an unassign in progress leaves no fork beside its offer', async () => {
    await assignTo(toPlayer('n'));
    const unassigning = await openTransaction(client, [
      `select id from accounts where id = 'c' for no key update`,
    ]);
    const forking = forkAssignment(
      db,
      { playerId: 'n', repertoireId: rep },
      LATER,
    );
    await someoneWaitsForALock(client);
    await unassigning.finish(
      `delete from assignments where repertoire_id = '${rep}'`,
    );
    expect(await forking).toEqual(NOT_FOUND);
    expect(await ownedIds('n')).toEqual([]);
  });

  it('makes an unassign wait for a fork in progress, which then offers nothing', async () => {
    await assignTo(toPlayer('n'));
    const [row] = await db.select({ id: assignments.id }).from(assignments);
    const forking = await openTransaction(client, [
      `select id from accounts where id = 'c' for no key update`,
      `insert into assignment_players (player_id, repertoire_id, forked_at)
       values ('n', '${rep}', now())`,
    ]);
    const unassigning = unassign(
      db,
      { coachId: 'c', assignmentId: must(row).id },
      LATER,
    );
    await someoneWaitsForALock(client);
    await forking.finish();
    expect(await unassigning).toEqual(OK);
    expect(await offerRows()).toEqual([]);
  });

  it('waits for a coach edit in progress and copies the saved graph', async () => {
    await assignTo(toPlayer('n'));
    const editing = await openTransaction(client, [
      `update repertoires set version = version + 1 where id = '${rep}'`,
    ]);
    const forking = forkAssignment(
      db,
      { playerId: 'n', repertoireId: rep },
      LATER,
    );
    await someoneWaitsForALock(client);
    await editing.finish(
      `update repertoire_moves set comment = 'Naujas' where repertoire_id = '${rep}' and san = 'd4'`,
    );
    const forked = await forking;
    if (!forked.ok) throw new Error(forked.refusal.reason);
    expect(await forkCoachNotesOn(db, 'n', forked.value.forkId)).toEqual([
      { moveKey: D4, text: 'Naujas', coachName: 'Name c' },
    ]);
  });
});

/** n accepts offer `offerId` at `now`. */
const acceptAt = (offerId: string, now: Date) =>
  acceptForkOffer(db, { playerId: 'n', offerId }, now);

describe('acceptForkOffer', () => {
  it('builds the fork from the snapshot, not from later coach edits, and marks the offer accepted', async () => {
    await assignTo(toPlayer('n'));
    await note('n', 'Mano pastaba');
    const snapshotGraph = await coachGraph();
    const [row] = await db.select({ id: assignments.id }).from(assignments);
    expect(
      await unassign(db, { coachId: 'c', assignmentId: must(row).id }, NOW),
    ).toEqual(OK);
    const { repertoire, graph } = must(await loadRepertoire(db, rep, 'c'));
    const nf6 = must(graph.moves.find((m) => m.san === 'Nf6'));
    const chapterId = must(graph.chapters[0]).id;
    expect(
      await editRepertoire(db, {
        id: rep,
        viewer: { id: 'c' },
        expectedVersion: repertoire.version,
        change: {
          kind: 'edit',
          op: { kind: 'addMove', chapterId, from: nf6.to, san: 'e3' },
        },
        now: NOW,
      }),
    ).toMatchObject({ ok: true });
    const offerId = await offerOf('n');
    const accepted = await acceptForkOffer(
      db,
      { playerId: 'n', offerId },
      LATER,
    );
    if (!accepted.ok) throw new Error(accepted.refusal.reason);
    const { forkId } = accepted.value;
    const forked = must(await loadRepertoire(db, forkId, 'n'));
    expect(forked.repertoire).toMatchObject({ name: 'Londono sistema' });
    expect(canonical(forked.graph)).toEqual(
      canonical(uncommented(snapshotGraph)),
    );
    expect(await forkCoachNotesOn(db, 'n', forkId)).toEqual([
      { moveKey: D4, text: COMMENT, coachName: 'Name c' },
    ]);
    expect(await listPersonalNotes(db, 'n', forkId)).toEqual({
      [D4]: 'Mano pastaba',
    });
    expect(await offerRows()).toEqual([
      {
        player_id: 'n',
        accepted_at: LATER,
        declined_at: null,
        fork_id: forkId,
      },
    ]);
    expect(await openForkOffers(db, 'n', LATER)).toEqual([]);
  });

  it('works after the coach deleted the repertoire (R-131)', async () => {
    await assignTo(toPlayer('n'));
    const before = await coachGraph();
    expect(await deleteRepertoire(db, rep, 'c', NOW)).toEqual(OK);
    const accepted = await acceptForkOffer(
      db,
      { playerId: 'n', offerId: await offerOf('n') },
      LATER,
    );
    if (!accepted.ok) throw new Error(accepted.refusal.reason);
    const forked = must(await loadRepertoire(db, accepted.value.forkId, 'n'));
    expect(canonical(forked.graph)).toEqual(canonical(uncommented(before)));
  });

  it("refuses another player's offer and writes nothing", async () => {
    await assignTo(toPlayer('n'));
    await deleteRepertoire(db, rep, 'c', NOW);
    const offerId = await offerOf('n');
    expect(
      await acceptForkOffer(db, { playerId: 'p', offerId }, LATER),
    ).toEqual(NOT_OPEN);
    expect(await ownedIds('p')).toEqual([]);
    expect(await offerRows()).toEqual([
      { player_id: 'n', accepted_at: null, declined_at: null, fork_id: null },
    ]);
  });

  it.each([
    ['expired', () => Promise.resolve(), forkOfferExpiry(NOW)],
    [
      'declined',
      async (id: string) => {
        await declineForkOffer(db, { playerId: 'n', offerId: id }, NOW);
      },
      LATER,
    ],
    [
      'accepted',
      async (id: string) => {
        await acceptAt(id, NOW);
      },
      LATER,
    ],
    [
      'closed',
      async () => {
        await assignTo(toPlayer('n'));
      },
      LATER,
    ],
  ])(
    'refuses an offer that is %s, and writes nothing',
    async (_, answerFirst, at) => {
      await assignTo(toPlayer('n'));
      const [row] = await db.select({ id: assignments.id }).from(assignments);
      await unassign(db, { coachId: 'c', assignmentId: must(row).id }, NOW);
      const offerId = await offerOf('n');
      await answerFirst(offerId);
      const owned = await ownedIds('n');
      const offers = await offerRows();
      expect(await acceptAt(offerId, at)).toEqual(NOT_OPEN);
      expect(await ownedIds('n')).toEqual(owned);
      expect(await offerRows()).toEqual(offers);
    },
  );

  it('refuses a malformed or unknown offer id', async () => {
    for (const offerId of ['nope', '00000000-0000-4000-8000-000000000000'])
      expect(
        await acceptForkOffer(db, { playerId: 'n', offerId }, LATER),
      ).toEqual(NOT_OPEN);
  });
});

describe('declineForkOffer', () => {
  it("declines the player's own open offer only", async () => {
    await assignTo(toPlayer('n'));
    await deleteRepertoire(db, rep, 'c', NOW);
    const offerId = await offerOf('n');
    expect(
      await declineForkOffer(db, { playerId: 'p', offerId }, LATER),
    ).toEqual(NOT_OPEN);
    expect(await openForkOffers(db, 'n', LATER)).toHaveLength(1);
    expect(
      await declineForkOffer(db, { playerId: 'n', offerId }, LATER),
    ).toEqual(OK);
    expect(await offerRows()).toEqual([
      { player_id: 'n', accepted_at: null, declined_at: LATER, fork_id: null },
    ]);
    expect(
      await declineForkOffer(db, { playerId: 'n', offerId }, LATER),
    ).toEqual(NOT_OPEN);
    expect(
      await declineForkOffer(db, { playerId: 'n', offerId: 'nope' }, LATER),
    ).toEqual(NOT_OPEN);
    expect(await ownedIds('n')).toEqual([]);
  });
});

describe('forkCoachNotesOn', () => {
  it("reads the notes of the player's own fork only", async () => {
    await assignTo(toGroup(g));
    const forkId = await fork('p');
    expect(await forkCoachNotesOn(db, 'q', forkId)).toEqual([]);
    expect(await forkCoachNotesOn(db, 'c', forkId)).toEqual([]);
    expect(await forkCoachNotesOn(db, 'p', 'nope')).toEqual([]);
  });
});

describe("a coach's account delete (R-49)", () => {
  it('forks for every player with a live assignment, before the cascade, with the coach notes kept', async () => {
    await assignTo(toPlayer('p'));
    await assignTo(toGroup(g));
    await note('q', 'Mano pastaba');
    const before = await coachGraph();
    await deleteAccount(db, 'c', LATER);
    expect(await query('select id from accounts order by id')).toEqual([
      { id: 'n' },
      { id: 'p' },
      { id: 'q' },
    ]);
    for (const playerId of ['p', 'q']) {
      const id = must((await ownedIds(playerId))[0]);
      const forked = must(await loadRepertoire(db, id, playerId));
      expect(canonical(forked.graph)).toEqual(canonical(uncommented(before)));
      expect(await forkCoachNotesOn(db, playerId, id)).toEqual([
        { moveKey: D4, text: COMMENT, coachName: 'Name c' },
      ]);
    }
    expect(
      await listPersonalNotes(db, 'q', must((await ownedIds('q'))[0])),
    ).toEqual({ [D4]: 'Mano pastaba' });
    expect(await ownedIds('n')).toEqual([]);
  });

  it('gives no second fork to a player who already forked', async () => {
    await assignTo(toGroup(g));
    const forkId = await fork('p');
    await deleteAccount(db, 'c', LATER);
    expect(await ownedIds('p')).toEqual([forkId]);
    expect(await ownedIds('q')).toHaveLength(1);
  });

  it('forks a paused assignment too', async () => {
    await assignTo(toPlayer('n'));
    await query(
      `insert into assignment_players (player_id, repertoire_id, paused_at) values ('n', $1, now())`,
      [rep],
    );
    await deleteAccount(db, 'c', LATER);
    expect(await ownedIds('n')).toHaveLength(1);
  });

  it("forks nothing when another coach's player is not assigned", async () => {
    await seedCoach(db, 'd', 'd@example.lt');
    await assignTo(toPlayer('n'));
    await deleteAccount(db, 'd', LATER);
    expect(await ownedIds('n')).toEqual([]);
    expect(await playerAssignments(db, 'n', NOW)).toHaveLength(1);
  });

  it("runs again when a player's concurrent delete deadlocks with it (#286)", async () => {
    await assignTo(toPlayer('p'));
    await assignTo(toPlayer('n'));
    // The player's delete holds p's row; the coach's delete waits for it to
    // fork for p; the player's transaction then asks for the coach's row.
    const deletingPlayer = await openTransaction(client, [
      `delete from accounts where id = 'p'`,
    ]);
    const deletingCoach = deleteAccount(db, 'c', LATER);
    await someoneWaitsForALock(client);
    await deletingPlayer.finish(
      `select 1 from accounts where id = 'c' for update`,
    );
    await deletingCoach;
    expect(await query('select id from accounts order by id')).toEqual([
      { id: 'n' },
      { id: 'q' },
    ]);
    expect(await ownedIds('n')).toHaveLength(1);
  });
});

describe('the data export', () => {
  it("lists a player's assignments with the coach, effective deadline and pause; a coach's none (R-139)", async () => {
    expect(
      await assign(
        db,
        {
          coachId: 'c',
          repertoireId: rep,
          target: toPlayer('p'),
          deadline: '2026-11-01',
        },
        NOW,
      ),
    ).toEqual(OK);
    await assignTo(toGroup(g));
    await pauseAssignment(
      db,
      { playerId: 'p', repertoireId: rep, paused: true },
      NOW,
    );
    const exported = async (id: string) =>
      must(await exportAccount(db, id, LATER)).coaching.assignments;
    const assigned = { repertoire: 'Londono sistema', coach: 'Name c' };
    expect(await exported('p')).toEqual([
      { ...assigned, deadline: '2026-11-01', paused: true },
    ]);
    expect(await exported('q')).toEqual([
      { ...assigned, deadline: null, paused: false },
    ]);
    expect(await exported('c')).toEqual([]);
  });

  it("lists a player's open fork offers with the coach and expiry (R-139)", async () => {
    await assignTo(toPlayer('n'));
    const [row] = await db.select({ id: assignments.id }).from(assignments);
    await unassign(db, { coachId: 'c', assignmentId: must(row).id }, NOW);
    const exported = async () =>
      must(await exportAccount(db, 'n', LATER)).coaching;
    expect(await exported()).toMatchObject({
      assignments: [],
      forkOffers: [
        {
          repertoire: 'Londono sistema',
          coach: 'Name c',
          expiresAt: forkOfferExpiry(NOW).toISOString(),
        },
      ],
    });
    const offerId = await offerOf('n');
    expect(
      await declineForkOffer(db, { playerId: 'n', offerId }, LATER),
    ).toEqual(OK);
    expect((await exported()).forkOffers).toEqual([]);
  });

  it("holds the coach notes of a player's own forks, never another player's (R-141)", async () => {
    await assignTo(toGroup(g));
    const forkId = await fork('p');
    const player = must(await exportAccount(db, 'p', LATER));
    expect(player.repertoires.map((r) => r.name)).toEqual(['Londono sistema']);
    expect(player.forkCoachNotes).toEqual([
      {
        repertoire: 'Londono sistema',
        position: fenOf(START_KEY),
        san: 'd4',
        text: COMMENT,
        coach: 'Name c',
      },
    ]);
    const text = JSON.stringify(player);
    expect(text).not.toContain(forkId);
    expect(text).not.toContain(rep);
    for (const id of ['q', 'c']) {
      const other = must(await exportAccount(db, id, LATER));
      expect(other.forkCoachNotes).toEqual([]);
      expect(other.coaching.coachNotes).toEqual([]);
    }
  });
});

describe("a coach's account delete over a batch (R-49)", () => {
  /** Coach `coachId` with a repertoire assigned to a group of `size` new players. */
  async function coachWithGroup(coachId: string, size: number) {
    await seedCoach(db, coachId, `${coachId}@example.lt`);
    const groupId = await seedGroup(db, coachId, `Grupė ${coachId}`);
    const repertoireId = await createRepertoire(db, {
      ownerId: coachId,
      side: 'white',
      name: `Repertuaras ${coachId}`,
      graph: graphOf(PGN),
      now: NOW,
    });
    const members = Array.from(
      { length: size },
      (_, i) => coachId + '-' + String(i + 1),
    );
    for (const playerId of members) {
      await seedPlayer(db, playerId, `${playerId}@example.lt`);
      await seedLink(db, coachId, playerId);
      await seedMember(db, coachId, groupId, playerId);
    }
    await db.insert(assignments).values({
      coachId,
      repertoireId,
      groupId,
      assignedVersion: 1,
      createdAt: NOW,
    });
    return { repertoireId, members };
  }

  const forksOf = (playerIds: readonly string[]) =>
    query(
      'select owner_account_id from repertoires where owner_account_id = any($1) order by owner_account_id',
      [playerIds],
    );

  it('reads the live assignments of five players in as many statements as of one, then forks each', async () => {
    const single = await coachWithGroup('e', 1);
    const fifth = await coachWithGroup('f', 5);
    const probe = await coachWithGroup('h', 1);
    const [probePlayer] = probe.members;
    const oneFork = await countStatements(() =>
      db.transaction((tx) =>
        forkAssignment(
          tx,
          { playerId: must(probePlayer), repertoireId: probe.repertoireId },
          LATER,
        ),
      ),
    );
    const forOne = await countStatements(() =>
      db.transaction((tx) => forkForDeletingCoach(tx, 'e', LATER)),
    );
    const forFive = await countStatements(() =>
      db.transaction((tx) => forkForDeletingCoach(tx, 'f', LATER)),
    );
    // Each fork is a savepoint and its writes; the reads before them are fixed.
    const perFork = oneFork - 2;
    expect(perFork).toBeGreaterThan(2);
    expect(forFive - forOne).toBe(4 * perFork);
    expect(await forksOf([...single.members, ...fifth.members])).toEqual(
      [...single.members, ...fifth.members].map((id) => ({
        owner_account_id: id,
      })),
    );
  });
});
