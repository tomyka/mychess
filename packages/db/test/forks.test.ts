import {
  addMove,
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
  exportAccount,
  forkAssignment,
  forkCoachNotesOn,
  listPersonalNotes,
  loadRepertoire,
  openForkOffers,
  playerAssignments,
  saveRepertoireEdit,
  setPersonalNote,
  trainingRepertoires,
  unassign,
} from '../src';
import { assignments } from '../src/assignment-schema';
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
    const edited = addMove(graph, must(graph.chapters[0]).id, nf6.to, 'e3');
    expect(
      await saveRepertoireEdit(db, {
        id: rep,
        ownerId: 'c',
        expectedVersion: repertoire.version,
        after: must(edited.ok ? edited.value : undefined),
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
});

describe('the data export', () => {
  it("lists a player's forks without the coach's notes in them (R-126)", async () => {
    await assignTo(toGroup(g));
    await fork('p');
    const player = must(await exportAccount(db, 'p', LATER));
    expect(player.repertoires.map((r) => r.name)).toEqual(['Londono sistema']);
    expect(Object.keys(player)).not.toContain('forkCoachNotes');
    expect(JSON.stringify(player)).not.toContain(COMMENT);
    expect(
      JSON.stringify(must(await exportAccount(db, 'c', LATER))),
    ).not.toContain('forkCoachNotes');
  });
});
