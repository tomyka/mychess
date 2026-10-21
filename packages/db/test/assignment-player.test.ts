import {
  addMove,
  editComment,
  moveKey,
  removeMove,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';
import { forkOfferExpiry } from '@mychess/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assign,
  assignedRepertoireForPlayer,
  changesSince,
  createRepertoire,
  listPersonalNotes,
  loadRepertoire,
  markSeen,
  openForkOffers,
  pauseAssignment,
  playerAssignments,
  removeMember,
  saveRepertoireEdit,
  setAssignedPersonalNote,
  setPersonalNote,
  trainingRepertoires,
  unassign,
  type LoadedRepertoire,
} from '../src';
import {
  assignmentPlayers,
  assignments,
  forkOffers,
} from '../src/assignment-schema';
import { liveRepertoire } from '../src/assignments/access';
import { loadRepertoireRows } from '../src/repertoires/repository';
import { groupMembers, personalNotes } from '../src/schema';
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
import { graphOf } from './support/repertoires';

const { db, client } = useTestDatabase();

const NOW = new Date('2026-10-20T09:00:00Z');
const LATER = new Date('2026-10-21T09:00:00Z');
const DAY_MS = 86_400_000;
/** R: the coach's comment on 1. d4; the player moves are d4 and Bf4. */
const PGN = '1. d4 { Treneris: tvirtas centras } d5 2. Bf4 Nf6 *';
const OK = { ok: true, value: undefined };
const NOT_FOUND = { ok: false, refusal: { reason: 'assignment.notFound' } };

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
  deadline: string | null = null,
  repertoireId = rep,
): Promise<void> {
  const done = await assign(
    db,
    { coachId: 'c', repertoireId, target, deadline },
    NOW,
  );
  expect(done).toEqual(OK);
}

const coachCopy = async (): Promise<LoadedRepertoire> =>
  must(await loadRepertoire(db, rep, 'c'));

type Edit = (graph: RepertoireGraph) => {
  ok: boolean;
  value?: RepertoireGraph;
};

/** The coach saves `edit` of R on top of the stored version, at `now`. */
async function coachEdit(edit: Edit, now = LATER): Promise<void> {
  const { repertoire, graph } = await coachCopy();
  const after = must(edit(graph).value);
  const saved = await saveRepertoireEdit(db, {
    id: rep,
    ownerId: 'c',
    expectedVersion: repertoire.version,
    after,
    now,
  });
  expect(saved.ok).toBe(true);
}

const moveOf = (graph: RepertoireGraph, san: string): RepertoireMove =>
  must(graph.moves.find((m) => m.san === san));
const chapterOf = (graph: RepertoireGraph): string =>
  must(graph.chapters[0]).id;

/** Adds 3. e3 after 2... Nf6: a new player move. */
const addE3: Edit = (graph) =>
  addMove(graph, chapterOf(graph), moveOf(graph, 'Nf6').to, 'e3');
const removeE3: Edit = (graph) =>
  removeMove(graph, chapterOf(graph), moveOf(graph, 'e3').from, 'e3');
/** Removes 2. Bf4 and the moves after it. */
const removeBf4: Edit = (graph) =>
  removeMove(graph, chapterOf(graph), moveOf(graph, 'Bf4').from, 'Bf4');
/** Adds 2. c4 where 2. Bf4 was: one answer per position (after removeBf4). */
const addC4: Edit = (graph) =>
  addMove(graph, chapterOf(graph), moveOf(graph, 'd5').to, 'c4');
const commentD4: Edit = (graph) =>
  editComment(graph, moveKey(moveOf(graph, 'd4').from, 'd4'), 'Pakeista');

const forkFor = (playerId: string, repertoireId = rep) =>
  db
    .insert(assignmentPlayers)
    .values({ playerId, repertoireId, forkedAt: NOW });

const stateRows = () =>
  query(
    'select player_id, paused_at, seen_version, forked_at from assignment_players order by player_id',
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

describe('playerAssignments', () => {
  it('lists a repertoire assigned individually and through a group once, with the individual deadline (R-134)', async () => {
    await assignTo(toGroup(g), '2026-10-30');
    await assignTo(toPlayer('p'), '2026-11-01');
    expect(await playerAssignments(db, 'p', NOW)).toEqual([
      {
        repertoireId: rep,
        name: 'Londono sistema',
        side: 'white',
        coachId: 'c',
        coachName: 'Name c',
        deadline: '2026-11-01',
        paused: false,
        updated: false,
        done: false,
        overdue: false,
      },
    ]);
  });

  it('is overdue from the Vilnius day after the effective deadline (R-16, R-51)', async () => {
    await assignTo(toGroup(g), '2026-10-19');
    expect(await playerAssignments(db, 'q', NOW)).toMatchObject([
      { deadline: '2026-10-19', overdue: true },
    ]);
  });

  it('is updated after a coach edit and not after markSeen (R-133)', async () => {
    await assignTo(toGroup(g));
    await coachEdit(addE3);
    expect(await playerAssignments(db, 'p', NOW)).toMatchObject([
      { updated: true },
    ]);
    expect(
      await markSeen(db, { playerId: 'p', repertoireId: rep, seenVersion: 2 }),
    ).toEqual(OK);
    expect(await playerAssignments(db, 'p', NOW)).toMatchObject([
      { updated: false },
    ]);
    expect(await playerAssignments(db, 'q', NOW)).toMatchObject([
      { updated: true },
    ]);
  });

  it('is not updated by an edit before the assignment, even when seen earlier', async () => {
    await coachEdit(commentD4);
    await assignTo(toPlayer('n'));
    await db
      .insert(assignmentPlayers)
      .values({ playerId: 'n', repertoireId: rep, seenVersion: 1 });
    expect(await playerAssignments(db, 'n', NOW)).toMatchObject([
      { updated: false },
    ]);
    expect(
      await changesSince(db, {
        playerId: 'n',
        repertoireId: rep,
        upToVersion: 99,
      }),
    ).toEqual({
      changes: { added: [], removed: [], annotated: 0 },
    });
  });

  it('is not updated by an edit before the assignment was made', async () => {
    await coachEdit(addE3);
    await assignTo(toPlayer('n'));
    expect(await playerAssignments(db, 'n', NOW)).toMatchObject([
      { updated: false },
    ]);
  });

  it('is paused after pauseAssignment (R-46)', async () => {
    await assignTo(toGroup(g));
    await pauseAssignment(
      db,
      { playerId: 'p', repertoireId: rep, paused: true },
      NOW,
    );
    expect(await playerAssignments(db, 'p', NOW)).toMatchObject([
      { paused: true },
    ]);
    expect(await playerAssignments(db, 'q', NOW)).toMatchObject([
      { paused: false },
    ]);
  });

  it('is done only for a repertoire without player moves until S6 (R-129)', async () => {
    const opponentOnly = await createRepertoire(db, {
      ownerId: 'c',
      side: 'black',
      name: 'Tik varžovo',
      graph: graphOf('1. d4 *', 'black'),
      now: NOW,
    });
    await assignTo(toPlayer('n'), '2026-10-01', opponentOnly);
    expect(await playerAssignments(db, 'n', NOW)).toMatchObject([
      { repertoireId: opponentOnly, side: 'black', done: true, overdue: false },
    ]);
  });

  it('leaves out a forked repertoire and lists nothing for a player without assignments', async () => {
    await assignTo(toGroup(g));
    await forkFor('p');
    expect(await playerAssignments(db, 'p', NOW)).toEqual([]);
    expect(await playerAssignments(db, 'n', NOW)).toEqual([]);
  });
});

describe('a player who joins a group after its assignment (R-136)', () => {
  const HOUR_MS = 3_600_000;
  const JOINED = new Date(LATER.getTime() + HOUR_MS);
  const AFTER_JOINING = new Date(LATER.getTime() + 2 * HOUR_MS);

  const nJoins = () =>
    db
      .insert(groupMembers)
      .values({ groupId: g, coachId: 'c', playerId: 'n', joinedAt: JOINED });
  const changesOfN = () =>
    changesSince(db, { playerId: 'n', repertoireId: rep, upToVersion: 99 });

  beforeEach(async () => {
    await assignTo(toGroup(g));
  });

  it('is not updated by an edit made before they joined, and nothing changed', async () => {
    await coachEdit(addE3);
    await nJoins();
    expect(await playerAssignments(db, 'n', NOW)).toMatchObject([
      { updated: false },
    ]);
    expect(await changesOfN()).toEqual({
      changes: { added: [], removed: [], annotated: 0 },
    });
    expect(await playerAssignments(db, 'p', NOW)).toMatchObject([
      { updated: true },
    ]);
  });

  it('is updated by an edit after they joined, with only that edit', async () => {
    await coachEdit(addE3);
    await nJoins();
    await coachEdit(commentD4, AFTER_JOINING);
    expect(await playerAssignments(db, 'n', NOW)).toMatchObject([
      { updated: true },
    ]);
    expect(await changesOfN()).toEqual({
      changes: { added: [], removed: [], annotated: 1 },
    });
  });

  it('counts an edit before they joined when also assigned individually before it', async () => {
    await assignTo(toPlayer('n'));
    await coachEdit(addE3);
    await nJoins();
    expect(await playerAssignments(db, 'n', NOW)).toMatchObject([
      { updated: true },
    ]);
    const { graph } = await coachCopy();
    expect(await changesOfN()).toEqual({
      changes: {
        added: [
          {
            moveKey: moveKey(moveOf(graph, 'e3').from, 'e3'),
            chapterId: chapterOf(graph),
          },
        ],
        removed: [],
        annotated: 0,
      },
    });
  });
});

describe('assignedRepertoireForPlayer', () => {
  beforeEach(async () => {
    for (const playerAccountId of ['p', 'q'])
      await db.insert(personalNotes).values({
        playerAccountId,
        repertoireId: rep,
        moveKey: 'k',
        text: `Pastaba ${playerAccountId}`,
        updatedAt: NOW,
      });
  });

  it("gives the player the repertoire with the coach's comments and only their own notes (R-21, R-102)", async () => {
    await assignTo(toGroup(g));
    const { repertoire, graph } = await coachCopy();
    const got = await assignedRepertoireForPlayer(db, 'p', rep, NOW);
    expect(got).toEqual({
      repertoire,
      graph,
      coachName: 'Name c',
      personalNotes: { k: 'Pastaba p' },
      paused: false,
      deadline: null,
      overdue: false,
    });
    expect(moveOf(must(got).graph, 'd4').comment).toBe(
      'Treneris: tvirtas centras',
    );
  });

  it('gives the effective deadline, overdue from the Vilnius day after it (R-16, R-51, R-134)', async () => {
    await assignTo(toGroup(g), '2026-10-19');
    await assignTo(toPlayer('p'), '2026-10-25');
    expect(await assignedRepertoireForPlayer(db, 'q', rep, NOW)).toMatchObject({
      deadline: '2026-10-19',
      overdue: true,
    });
    expect(await assignedRepertoireForPlayer(db, 'p', rep, NOW)).toMatchObject({
      deadline: '2026-10-25',
      overdue: false,
    });
  });

  it('is not overdue once done, nor on the deadline day itself (R-51)', async () => {
    const opponentOnly = await createRepertoire(db, {
      ownerId: 'c',
      side: 'black',
      name: 'Tik varžovo',
      graph: graphOf('1. d4 *', 'black'),
      now: NOW,
    });
    await assignTo(toPlayer('n'), '2026-10-01', opponentOnly);
    expect(
      await assignedRepertoireForPlayer(db, 'n', opponentOnly, NOW),
    ).toMatchObject({ deadline: '2026-10-01', overdue: false });
    await assignTo(toPlayer('p'), '2026-10-20');
    expect(await assignedRepertoireForPlayer(db, 'p', rep, NOW)).toMatchObject({
      deadline: '2026-10-20',
      overdue: false,
    });
  });

  it('says when the player paused it', async () => {
    await assignTo(toPlayer('p'));
    await pauseAssignment(
      db,
      { playerId: 'p', repertoireId: rep, paused: true },
      NOW,
    );
    expect(await assignedRepertoireForPlayer(db, 'p', rep, NOW)).toMatchObject({
      paused: true,
    });
  });

  it.each([
    ['a repertoire not assigned to the player', 'n', 'rep'],
    ['a forked one', 'p', 'rep'],
    ["the coach's other repertoire", 'p', 'other'],
    ['a missing id', 'p', 'missing'],
    ['a malformed id', 'p', 'malformed'],
  ] as const)('gives nothing for %s', async (_, playerId, which) => {
    await assignTo(toGroup(g));
    await forkFor('p');
    const other = await createRepertoire(db, {
      ownerId: 'c',
      side: 'white',
      name: 'Kitas',
      graph: graphOf(PGN),
      now: NOW,
    });
    const ids = {
      rep,
      other,
      missing: '00000000-0000-4000-8000-000000000000',
      malformed: 'not-a-uuid',
    };
    expect(
      await assignedRepertoireForPlayer(db, playerId, ids[which], NOW),
    ).toBeUndefined();
  });

  it('gives the repertoire again once a new assignment clears the fork (plan decision 8)', async () => {
    await assignTo(toGroup(g));
    await forkFor('p');
    await assignTo(toPlayer('p'));
    expect(await assignedRepertoireForPlayer(db, 'p', rep, NOW)).toBeDefined();
  });
});

describe('setAssignedPersonalNote (R-21)', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
  const write = (
    playerId: string,
    text: string,
    { repertoireId = rep, san = 'd4' } = {},
  ) =>
    setAssignedPersonalNote(db, {
      playerId,
      repertoireId,
      moveKey: moveKey(START, san),
      text,
      now: NOW,
    });
  const noteRows = () =>
    query(
      'select player_account_id, text from personal_notes order by player_account_id',
    );

  it('sets and removes the note on a move of a live assignment', async () => {
    await assignTo(toGroup(g));
    expect(await write('p', 'Pastaba p')).toEqual(OK);
    expect(await noteRows()).toEqual([
      { player_account_id: 'p', text: 'Pastaba p' },
    ]);
    expect(await write('p', '')).toEqual(OK);
    expect(await noteRows()).toEqual([]);
  });

  it.each([
    ['the coach who owns it', 'c'],
    ['a player it is not assigned to', 'n'],
  ])('refuses %s as not assigned, and writes nothing', async (_, who) => {
    await assignTo(toGroup(g));
    for (const text of ['Svetima', ''])
      expect(await write(who, text)).toEqual(NOT_FOUND);
    expect(await noteRows()).toEqual([]);
  });

  it('refuses a forked assignment and an id that is no uuid', async () => {
    await assignTo(toGroup(g));
    await forkFor('p');
    expect(await write('p', 'Vėliau')).toEqual(NOT_FOUND);
    expect(await write('q', 'Vėliau', { repertoireId: 'not-a-uuid' })).toEqual(
      NOT_FOUND,
    );
    expect(await noteRows()).toEqual([]);
  });

  it('refuses a note on a move the repertoire does not have, removing one on any key (decision 11)', async () => {
    await assignTo(toGroup(g));
    expect(await write('p', 'Ne šito', { san: 'e4' })).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.notFound' },
    });
    expect(await noteRows()).toEqual([]);
    expect(await write('p', '', { san: 'e4' })).toEqual(OK);
  });
});

describe('pauseAssignment', () => {
  it("pauses and resumes the player's own assignment, out of training meanwhile (R-46)", async () => {
    await assignTo(toGroup(g));
    expect(
      await pauseAssignment(
        db,
        { playerId: 'p', repertoireId: rep, paused: true },
        NOW,
      ),
    ).toEqual(OK);
    expect(await stateRows()).toEqual([
      { player_id: 'p', paused_at: NOW, seen_version: null, forked_at: null },
    ]);
    expect(await trainingRepertoires(db, 'p')).toMatchObject([
      { id: rep, active: false },
    ]);
    expect(
      await pauseAssignment(
        db,
        { playerId: 'p', repertoireId: rep, paused: false },
        LATER,
      ),
    ).toEqual(OK);
    expect(await stateRows()).toEqual([
      { player_id: 'p', paused_at: null, seen_version: null, forked_at: null },
    ]);
    expect(await trainingRepertoires(db, 'p')).toMatchObject([
      { id: rep, active: true },
    ]);
  });

  it.each([
    ['not assigned to the player', 'n', 'rep'],
    ['forked by the player', 'p', 'rep'],
    ['malformed', 'p', 'malformed'],
  ] as const)(
    'refuses one %s and writes nothing',
    async (_, playerId, which) => {
      await assignTo(toGroup(g));
      await forkFor('p');
      const before = await stateRows();
      const repertoireId = which === 'rep' ? rep : 'not-a-uuid';
      expect(
        await pauseAssignment(
          db,
          { playerId, repertoireId, paused: true },
          NOW,
        ),
      ).toEqual(NOT_FOUND);
      expect(await stateRows()).toEqual(before);
    },
  );

  it('waits for a group leave in progress and then finds nothing to pause', async () => {
    await assignTo(toGroup(g));
    const leaving = await openTransaction(client, [
      `delete from group_members where player_id = 'p'`,
    ]);
    const pausing = pauseAssignment(
      db,
      { playerId: 'p', repertoireId: rep, paused: true },
      NOW,
    );
    await someoneWaitsForALock(client);
    await leaving.finish();
    expect(await pausing).toEqual(NOT_FOUND);
    expect(await stateRows()).toEqual([]);
  });

  it("holds the membership it read, so a removal after it drops the player's state", async () => {
    await assignTo(toGroup(g));
    const pausing = await openTransaction(client, [
      `select 1 from group_members where player_id = 'p' for key share`,
      `insert into assignment_players (player_id, repertoire_id, paused_at)
       values ('p', '${rep}', now())`,
    ]);
    const removing = removeMember(
      db,
      { coachId: 'c', groupId: g, playerId: 'p' },
      LATER,
    );
    await someoneWaitsForALock(client);
    await pausing.finish();
    expect(await removing).toEqual(OK);
    expect(await stateRows()).toEqual([]);
  });
});

describe('markSeen', () => {
  it('sets the seen version to the version the page showed', async () => {
    await assignTo(toGroup(g));
    await coachEdit(addE3);
    expect(
      await markSeen(db, { playerId: 'p', repertoireId: rep, seenVersion: 2 }),
    ).toEqual(OK);
    expect(await stateRows()).toEqual([
      { player_id: 'p', paused_at: null, seen_version: 2, forked_at: null },
    ]);
  });

  it('keeps an edit made after the page read "updated" (R-133)', async () => {
    await assignTo(toGroup(g));
    await coachEdit(addE3);
    // The page showed version 2; the coach saves version 3 before markSeen.
    await coachEdit(commentD4);
    expect(
      await markSeen(db, { playerId: 'p', repertoireId: rep, seenVersion: 2 }),
    ).toEqual(OK);
    expect(await playerAssignments(db, 'p', NOW)).toMatchObject([
      { updated: true },
    ]);
    expect(
      await changesSince(db, {
        playerId: 'p',
        repertoireId: rep,
        upToVersion: 99,
      }),
    ).toMatchObject({
      changes: { added: [], removed: [], annotated: 1 },
    });
  });

  it('never stores a version below zero', async () => {
    await assignTo(toGroup(g));
    expect(
      await markSeen(db, { playerId: 'p', repertoireId: rep, seenVersion: -5 }),
    ).toEqual(OK);
    expect(await stateRows()).toEqual([
      { player_id: 'p', paused_at: null, seen_version: 0, forked_at: null },
    ]);
  });

  it('never lowers the seen version, nor sets it above the current one', async () => {
    await assignTo(toGroup(g));
    await coachEdit(addE3);
    await markSeen(db, { playerId: 'p', repertoireId: rep, seenVersion: 2 });
    await coachEdit(commentD4);
    await markSeen(db, { playerId: 'p', repertoireId: rep, seenVersion: 1 });
    await markSeen(db, { playerId: 'q', repertoireId: rep, seenVersion: 99 });
    expect(await stateRows()).toEqual([
      { player_id: 'p', paused_at: null, seen_version: 2, forked_at: null },
      { player_id: 'q', paused_at: null, seen_version: 3, forked_at: null },
    ]);
  });

  it('refuses a repertoire not assigned to the player and writes nothing', async () => {
    await assignTo(toGroup(g));
    expect(
      await markSeen(db, { playerId: 'n', repertoireId: rep, seenVersion: 1 }),
    ).toEqual(NOT_FOUND);
    expect(
      await markSeen(db, {
        playerId: 'p',
        repertoireId: 'not-a-uuid',
        seenVersion: 1,
      }),
    ).toEqual(NOT_FOUND);
    expect(await stateRows()).toEqual([]);
  });
});

describe('changesSince', () => {
  it('nets the edits since the assignment, by chapter (R-133)', async () => {
    await assignTo(toGroup(g));
    await coachEdit(addE3);
    // Removing 2. Bf4 takes 3. e3 with it: added then removed, no change.
    await coachEdit(removeBf4);
    await coachEdit((graph) => commentD4(must(addC4(graph).value)));
    const { graph } = await coachCopy();
    const chapter = must(graph.chapters[0]);
    const before = graphOf(PGN);
    expect(
      await changesSince(db, {
        playerId: 'p',
        repertoireId: rep,
        upToVersion: 99,
      }),
    ).toEqual({
      changes: {
        added: [
          {
            moveKey: moveKey(moveOf(graph, 'c4').from, 'c4'),
            chapterId: chapter.id,
          },
        ],
        removed: [
          {
            moveKey: moveKey(moveOf(before, 'Bf4').from, 'Bf4'),
            chapterId: chapter.id,
          },
        ],
        annotated: 1,
      },
    });
  });

  it('starts from the version the player last saw', async () => {
    await assignTo(toGroup(g));
    await coachEdit(addE3);
    await markSeen(db, { playerId: 'p', repertoireId: rep, seenVersion: 2 });
    await coachEdit(commentD4);
    expect(
      await changesSince(db, {
        playerId: 'p',
        repertoireId: rep,
        upToVersion: 99,
      }),
    ).toEqual({
      changes: { added: [], removed: [], annotated: 1 },
    });
  });

  it('starts from the version assigned, and a move added then removed is no change', async () => {
    await coachEdit(commentD4);
    await assignTo(toPlayer('n'));
    await coachEdit(addE3);
    await coachEdit(removeE3);
    expect(
      await changesSince(db, {
        playerId: 'n',
        repertoireId: rep,
        upToVersion: 99,
      }),
    ).toEqual({
      changes: { added: [], removed: [], annotated: 0 },
    });
  });

  it('stops at the version the page showed, so a later edit is not mixed in', async () => {
    await assignTo(toGroup(g));
    await coachEdit(addE3);
    await coachEdit(commentD4);
    const { graph } = await coachCopy();
    expect(
      await changesSince(db, {
        playerId: 'p',
        repertoireId: rep,
        upToVersion: 2,
      }),
    ).toEqual({
      changes: {
        added: [
          {
            moveKey: moveKey(moveOf(graph, 'e3').from, 'e3'),
            chapterId: chapterOf(graph),
          },
        ],
        removed: [],
        annotated: 0,
      },
    });
    expect(
      await changesSince(db, {
        playerId: 'p',
        repertoireId: rep,
        upToVersion: 1,
      }),
    ).toEqual({ changes: { added: [], removed: [], annotated: 0 } });
  });

  it('gives nothing for a repertoire not assigned to the player', async () => {
    await assignTo(toGroup(g));
    await coachEdit(addE3);
    expect(
      await changesSince(db, {
        playerId: 'n',
        repertoireId: rep,
        upToVersion: 99,
      }),
    ).toBeUndefined();
    expect(
      await changesSince(db, {
        playerId: 'p',
        repertoireId: 'not-a-uuid',
        upToVersion: 99,
      }),
    ).toBeUndefined();
  });
});

describe('trainingRepertoires', () => {
  it('lists the player’s own repertoires and their live assigned ones', async () => {
    const own = await createRepertoire(db, {
      ownerId: 'p',
      side: 'black',
      name: 'Karo-Kan',
      graph: graphOf('1. e4 c6 *', 'black'),
      now: NOW,
    });
    await assignTo(toGroup(g));
    expect(await trainingRepertoires(db, 'p')).toEqual([
      {
        id: own,
        graph: must(await loadRepertoire(db, own, 'p')).graph,
        active: true,
      },
      { id: rep, graph: (await coachCopy()).graph, active: true },
    ]);
  });

  it('leaves out a forked one (R-128)', async () => {
    await assignTo(toGroup(g));
    await forkFor('p');
    expect(await trainingRepertoires(db, 'p')).toEqual([]);
    expect(await trainingRepertoires(db, 'q')).toMatchObject([{ id: rep }]);
  });
});

describe('openForkOffers', () => {
  async function offer(
    playerId: string,
    createdAt: Date,
    answer: Partial<
      Record<'acceptedAt' | 'declinedAt' | 'closedAt', Date>
    > = {},
  ): Promise<string> {
    const [row] = await db
      .insert(forkOffers)
      .values({
        playerId,
        repertoireId: rep,
        coachName: 'Name c',
        name: 'Londono sistema',
        side: 'white',
        snapshot: {},
        reason: 'leftGroup',
        createdAt,
        expiresAt: forkOfferExpiry(createdAt),
        ...answer,
      })
      .returning({ id: forkOffers.id });
    return must(row).id;
  }

  it('lists only the player’s open offers, newest first, with the days left (R-44)', async () => {
    const older = await offer('p', new Date(NOW.getTime() - 10 * DAY_MS));
    const newer = await offer('p', NOW);
    await offer('p', new Date(NOW.getTime() - 30 * DAY_MS));
    await offer('p', NOW, { acceptedAt: NOW });
    await offer('p', NOW, { declinedAt: NOW });
    await offer('p', NOW, { closedAt: NOW });
    await offer('q', NOW);
    const listed = {
      repertoireId: rep,
      name: 'Londono sistema',
      side: 'white',
      coachName: 'Name c',
      reason: 'leftGroup',
    };
    expect(await openForkOffers(db, 'p', NOW)).toEqual([
      {
        ...listed,
        id: newer,
        expiresAt: forkOfferExpiry(NOW),
        daysLeft: 30,
      },
      {
        ...listed,
        id: older,
        expiresAt: new Date(NOW.getTime() + 20 * DAY_MS),
        daysLeft: 20,
      },
    ]);
    expect(await openForkOffers(db, 'n', NOW)).toEqual([]);
  });
});

describe('liveRepertoire (the query-level filter)', () => {
  it('selects a repertoire only for a player it reaches live', async () => {
    await assignTo(toGroup(g));
    await forkFor('q');
    const loads = async (playerId: string) =>
      (await loadRepertoireRows(db, liveRepertoire(db, playerId, rep)))
        ?.repertoire.id;
    expect(await loads('p')).toBe(rep);
    expect(await loads('q')).toBeUndefined();
    expect(await loads('n')).toBeUndefined();
    await assignTo(toPlayer('n'));
    expect(await loads('n')).toBe(rep);
  });
});

describe('personal notes on an assigned repertoire (R-21)', () => {
  const NOTE_REFUSED = {
    ok: false,
    refusal: { reason: 'repertoire.notFound' },
  };
  const D4 = moveKey(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
    'd4',
  );
  const note = (playerId: string, text = `Pastaba ${playerId}`) =>
    setPersonalNote(db, {
      playerId,
      repertoireId: rep,
      moveKey: D4,
      text,
      now: NOW,
    });
  const noteRows = () =>
    query(
      'select player_account_id, text from personal_notes order by player_account_id',
    );

  it('lets each player keep their own notes on a live assignment', async () => {
    await assignTo(toGroup(g));
    expect(await note('p')).toEqual(OK);
    expect(await note('q')).toEqual(OK);
    expect(await listPersonalNotes(db, 'p', rep)).toEqual({
      [D4]: 'Pastaba p',
    });
    expect(await note('p', '')).toEqual(OK);
    expect(await listPersonalNotes(db, 'p', rep)).toEqual({});
    expect(await listPersonalNotes(db, 'q', rep)).toEqual({
      [D4]: 'Pastaba q',
    });
  });

  it('refuses a player it is not assigned to, and lists nothing for them', async () => {
    await assignTo(toGroup(g));
    await note('p');
    expect(await note('n')).toEqual(NOTE_REFUSED);
    expect(await listPersonalNotes(db, 'n', rep)).toEqual({});
    expect(await noteRows()).toEqual([
      { player_account_id: 'p', text: 'Pastaba p' },
    ]);
  });

  it('refuses and lists nothing once the assignment ends (R-130)', async () => {
    await assignTo(toPlayer('n'));
    await note('n');
    const [row] = await db.select({ id: assignments.id }).from(assignments);
    await unassign(db, { coachId: 'c', assignmentId: must(row).id }, LATER);
    expect(await note('n', 'Vėliau')).toEqual(NOTE_REFUSED);
    expect(await listPersonalNotes(db, 'n', rep)).toEqual({});
  });

  it('refuses and lists nothing once the player forked it (R-128)', async () => {
    await assignTo(toGroup(g));
    await note('p');
    await forkFor('p');
    expect(await note('p', 'Vėliau')).toEqual(NOTE_REFUSED);
    expect(await listPersonalNotes(db, 'p', rep)).toEqual({});
  });

  it('refuses a note on a move the assigned repertoire does not have, and writes nothing (decision 11)', async () => {
    await assignTo(toGroup(g));
    const e4 = moveKey(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
      'e4',
    );
    const write = (text: string) =>
      setPersonalNote(db, {
        playerId: 'p',
        repertoireId: rep,
        moveKey: e4,
        text,
        now: NOW,
      });
    expect(await write('Ne šito')).toEqual(NOTE_REFUSED);
    expect(await noteRows()).toEqual([]);
    expect(await write('')).toEqual(OK);
  });

  it('waits for a group leave in progress and then refuses the note', async () => {
    await assignTo(toGroup(g));
    const leaving = await openTransaction(client, [
      `delete from group_members where player_id = 'p'`,
    ]);
    const noting = note('p');
    await someoneWaitsForALock(client);
    await leaving.finish();
    expect(await noting).toEqual(NOTE_REFUSED);
    expect(await noteRows()).toEqual([]);
  });
});
