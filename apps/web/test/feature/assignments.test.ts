// Access to assigned repertoires (S5 Task C5, plan decisions 11 and 12).
// The assigned page answers 404 to anyone the repertoire is not assigned to
// now, and the player's actions on it act only for the session account:
// someone else's ids and forged playerId or coachId fields change nothing.
// Every refusal is checked against the whole assignment state of the
// database, before and after.
import { moveKey, START_KEY } from '@mychess/chess';
import {
  assign,
  leaveGroup,
  setPersonalNote,
  unassign,
  unlink,
} from '@mychess/db';
import type { AssignmentTarget } from '@mychess/domain';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  forkAction,
  markSeenAction,
  pauseAction,
  setPersonalNoteAction,
} from '../../src/app/repertuarai/priskirti/[id]/actions';
import AssignedRepertoirePage from '../../src/app/repertuarai/priskirti/[id]/page';
import { repertoireRoute } from '../../src/lib/routes';
import { assignedRepertoireData } from '../../src/server/assignment-pages';
import { repertoirePageData } from '../../src/server/repertoires';
import {
  actAs,
  coachPerson,
  formOf,
  groupOf,
  link,
  person,
  type Person,
} from './support/coaching';
import { useRequestHarness } from './support/harness';
import { outcomeOf, request, testDb } from './support/request';
import { LONDON, seedRepertoire, TAIMANOV } from './support/repertoires';

vi.mock('next/headers', async () =>
  (await import('./support/request')).nextHeaders(),
);
vi.mock('next/navigation', async () =>
  (await import('./support/request')).nextNavigation(),
);
vi.mock('next/cache', async () =>
  (await import('./support/request')).nextCache(),
);
vi.mock('../../src/server/db', async () =>
  (await import('./support/request')).serverDb(),
);
vi.mock('../../src/server/auth', async (original) =>
  (await import('./support/request')).serverAuth(original),
);

const { sql } = useRequestHarness();

const D4 = moveKey(START_KEY, 'd4');
const E4 = moveKey(START_KEY, 'e4');

/** Rokas's personal note on 1. d4 of the London he is assigned. */
const ROKAS_NOTE = 'Rokas: tik man';

/** The refusal every player action on this page answers with. */
const NOT_ASSIGNED = 'assignment.notFound';

interface Cast {
  /** Coach; Rokas is in his group, Gabija is linked to him alone. */
  readonly rimantas: Person;
  /** Assigned the London alone, and the Taimanov through the group. */
  readonly rokas: Person;
  /** Linked to Rimantas, assigned the Taimanov alone; not the London. */
  readonly gabija: Person;
  /** Linked to nobody, assigned nothing. */
  readonly jonas: Person;
  /** Rimantas's "Šeštadienio grupė". */
  readonly group: string;
  /** Rimantas's London, with his comments, assigned to Rokas. */
  readonly london: string;
  /** Rimantas's Taimanov, assigned to the group and to Gabija. */
  readonly taimanov: string;
}

async function assignTo(
  coachId: string,
  repertoireId: string,
  target: AssignmentTarget,
): Promise<void> {
  const done = await assign(
    testDb(),
    { coachId, repertoireId, target, deadline: null },
    new Date(),
  );
  if (!done.ok) throw new Error(`not assigned: ${done.refusal.reason}`);
}

async function cast(): Promise<Cast> {
  const rimantas = await coachPerson(sql, 'rimantas@example.lt', 'Rimantas');
  const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
  const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
  const jonas = await person(sql, 'jonas@example.lt', 'Jonas');
  const group = await groupOf(rimantas.id, 'Šeštadienio grupė');
  await link(rimantas.id, rokas.id, group);
  await link(rimantas.id, gabija.id);
  const london = await seedRepertoire(testDb(), 'rimantas@example.lt', {
    pgn: LONDON,
    side: 'white',
    name: 'Londono sistema',
  });
  const taimanov = await seedRepertoire(testDb(), 'rimantas@example.lt', {
    pgn: TAIMANOV,
    side: 'black',
    name: 'Taimanovas',
  });
  await assignTo(rimantas.id, london, { kind: 'player', playerId: rokas.id });
  await assignTo(rimantas.id, taimanov, { kind: 'group', groupId: group });
  await assignTo(rimantas.id, taimanov, {
    kind: 'player',
    playerId: gabija.id,
  });
  const noted = await setPersonalNote(testDb(), {
    playerId: rokas.id,
    repertoireId: london,
    moveKey: D4,
    text: ROKAS_NOTE,
    now: new Date(),
  });
  if (!noted.ok) throw new Error(`no note: ${noted.refusal.reason}`);
  return { rimantas, rokas, gabija, jonas, group, london, taimanov };
}

/** The tables an assignment, its player state, a fork or a note live in. */
const TABLES = [
  'repertoires',
  'repertoire_moves',
  'assignments',
  'assignment_players',
  'repertoire_changes',
  'fork_offers',
  'fork_coach_notes',
  'personal_notes',
  'coach_notes',
  'coach_links',
  'group_members',
] as const;

/** Every row of those tables, in a stable order, to compare before and after. */
async function state(): Promise<Record<string, unknown[]>> {
  const read = await Promise.all(
    TABLES.map(
      async (table) =>
        [
          table,
          await sql.rows(`select * from ${table} t order by t::text`),
        ] as const,
    ),
  );
  return Object.fromEntries(read);
}

/** The assigned page for `id`, as Next.js calls it. */
const openPage = (id: string): Promise<unknown> =>
  outcomeOf(AssignedRepertoirePage({ params: Promise.resolve({ id }) }));

/** The player's pause or resume form. */
const pauseForm = (
  repertoireId: string,
  paused: boolean,
  extra: Readonly<Record<string, string>> = {},
): FormData =>
  formOf({ repertoireId, paused: paused ? 'true' : 'false', ...extra });

/** Each player's pause, seen and fork state, by display name. */
const playerStates = (): Promise<unknown[]> =>
  sql.rows(
    `select a.display_name as player, r.name as repertoire,
            s.paused_at is not null as paused,
            s.forked_at is not null as forked,
            s.seen_version
       from assignment_players s
       join accounts a on a.id = s.player_id
       join repertoires r on r.id = s.repertoire_id
      order by 1, 2`,
  );

/** Every repertoire by owner and name. */
const repertoireOwners = (): Promise<unknown[]> =>
  sql.rows(
    `select a.display_name as owner, r.name
       from repertoires r join accounts a on a.id = r.owner_account_id
      order by 1, 2`,
  );

const oneIdSchema = z.tuple([z.object({ id: z.string().min(1) })]);

/** The id of the one row `query` selects; throws unless there is one. */
async function oneId(query: string, params: unknown[] = []): Promise<string> {
  return oneIdSchema.parse(await sql.rows(query, params))[0].id;
}

/** The id of the assignment of `repertoireId` straight to `playerId`. */
const assignmentId = (repertoireId: string, playerId: string) =>
  oneId(
    'select id from assignments where repertoire_id = $1 and player_id = $2',
    [repertoireId, playerId],
  );

/** The id of Rokas's one repertoire: his fork. */
const rokasFork = (): Promise<string> =>
  oneId(
    `select r.id from repertoires r
       join accounts a on a.id = r.owner_account_id
      where a.email = 'rokas@example.lt'`,
  );

/** The comments of a graph's moves, in the order stored. */
const commentsOf = (graph: {
  readonly moves: readonly { readonly comment: string | null }[];
}): string[] =>
  graph.moves.flatMap((move) => (move.comment === null ? [] : [move.comment]));

describe('the assigned repertoire page (plan decision 11)', () => {
  it('shows the assigned player the repertoire, its coach and their own notes', async () => {
    const { rokas, london, taimanov } = await cast();
    const before = await state();
    actAs(rokas);
    expect(await assignedRepertoireData(london)).toMatchObject({
      repertoire: { id: london, name: 'Londono sistema', side: 'white' },
      coachName: 'Rimantas',
      personalNotes: { [D4]: ROKAS_NOTE },
      paused: false,
    });
    expect(await assignedRepertoireData(taimanov)).toMatchObject({
      repertoire: { id: taimanov, name: 'Taimanovas', side: 'black' },
      coachName: 'Rimantas',
      personalNotes: {},
    });
    expect(await state()).toEqual(before);
  });
});

describe('the assigned page is 404 (plan decision 12)', () => {
  it.each([
    ['a linked player it is not assigned to', 'gabija'],
    ['an account with no coach', 'jonas'],
    ['the coach who owns it', 'rimantas'],
  ] as const)('for %s', async (_who, name) => {
    const people = await cast();
    const before = await state();
    actAs(people[name]);
    expect(await openPage(people.london)).toEqual({ notFound: true });
    expect(await state()).toEqual(before);
  });

  it('for the player after the coach unassigns it', async () => {
    const { rimantas, rokas, london } = await cast();
    const assignment = await assignmentId(london, rokas.id);
    actAs(rokas);
    expect(await assignedRepertoireData(london)).toMatchObject({
      repertoire: { id: london },
    });
    const done = await unassign(
      testDb(),
      { coachId: rimantas.id, assignmentId: assignment },
      new Date(),
    );
    expect(done.ok).toBe(true);
    const before = await state();
    expect(await openPage(london)).toEqual({ notFound: true });
    expect(await state()).toEqual(before);
  });

  it('for the player after an unlink, individual and group assignments alike', async () => {
    const { rimantas, rokas, london, taimanov } = await cast();
    const done = await unlink(testDb(), rimantas.id, rokas.id, new Date());
    expect(done.ok).toBe(true);
    const before = await state();
    actAs(rokas);
    expect(await openPage(london)).toEqual({ notFound: true });
    expect(await openPage(taimanov)).toEqual({ notFound: true });
    expect(await state()).toEqual(before);
  });

  it('for the player after leaving the group, which keeps the individual one', async () => {
    const { rokas, group, london, taimanov } = await cast();
    const left = await leaveGroup(testDb(), rokas.id, group, new Date());
    expect(left.ok).toBe(true);
    const before = await state();
    actAs(rokas);
    expect(await openPage(taimanov)).toEqual({ notFound: true });
    expect(await assignedRepertoireData(london)).toMatchObject({
      repertoire: { id: london, name: 'Londono sistema' },
    });
    expect(await state()).toEqual(before);
  });

  it('for the player after forking it, who is sent to the fork', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    const forked = await outcomeOf(
      forkAction({}, formOf({ repertoireId: london })),
    );
    expect(forked).toEqual({
      redirectedTo: repertoireRoute(await rokasFork()),
    });
    const before = await state();
    expect(await openPage(london)).toEqual({ notFound: true });
    expect(await state()).toEqual(before);
  });

  it.each([
    ['not a uuid', 'nėra'],
    ['empty', ''],
    ['a uuid with a path in it', '../00000000-0000-4000-8000-000000000000'],
    ['an unknown uuid', randomUUID()],
  ])('for a malformed or unknown id: %s', async (_kind, id) => {
    const { rokas } = await cast();
    const before = await state();
    actAs(rokas);
    expect(await openPage(id)).toEqual({ notFound: true });
    expect(await state()).toEqual(before);
  });

  it('sends a signed-out visitor to sign-in', async () => {
    const { london } = await cast();
    const before = await state();
    request.cookie = '';
    expect(await openPage(london)).toEqual({ redirectedTo: '/prisijungti' });
    expect(await state()).toEqual(before);
  });
});

describe('the player actions with someone else’s ids change nothing', () => {
  it.each([
    ['a linked player it is not assigned to', 'gabija'],
    ['an account with no coach', 'jonas'],
    ['the coach who owns it', 'rimantas'],
  ] as const)('pauseAction on Rokas’s London, as %s', async (_who, name) => {
    const people = await cast();
    const before = await state();
    actAs(people[name]);
    expect(
      await outcomeOf(
        pauseAction(
          { paused: false },
          pauseForm(people.london, true, { playerId: people.rokas.id }),
        ),
      ),
    ).toEqual({ paused: false, refusal: NOT_ASSIGNED });
    expect(await state()).toEqual(before);
  });

  it.each([
    ['a linked player it is not assigned to', 'gabija'],
    ['an account with no coach', 'jonas'],
    ['the coach who owns it', 'rimantas'],
  ] as const)('forkAction on Rokas’s London, as %s', async (_who, name) => {
    const people = await cast();
    const before = await state();
    actAs(people[name]);
    expect(
      await outcomeOf(
        forkAction(
          {},
          formOf({ repertoireId: people.london, playerId: people.rokas.id }),
        ),
      ),
    ).toEqual({ refusal: NOT_ASSIGNED });
    expect(await state()).toEqual(before);
  });

  it.each([
    ['a linked player it is not assigned to', 'gabija'],
    ['an account with no coach', 'jonas'],
    ['the coach who owns it', 'rimantas'],
  ] as const)(
    'setPersonalNoteAction on Rokas’s London, as %s',
    async (_who, name) => {
      const people = await cast();
      const before = await state();
      actAs(people[name]);
      for (const text of ['Svetima pastaba', ''])
        expect(
          await outcomeOf(
            setPersonalNoteAction({
              repertoireId: people.london,
              moveKey: D4,
              text,
              playerId: people.rokas.id,
            }),
          ),
        ).toEqual({ ok: false, refusal: NOT_ASSIGNED });
      expect(await state()).toEqual(before);
    },
  );

  it.each([
    ['a linked player it is not assigned to', 'gabija'],
    ['an account with no coach', 'jonas'],
    ['the coach who owns it', 'rimantas'],
  ] as const)('markSeenAction on Rokas’s London, as %s', async (_who, name) => {
    const people = await cast();
    const before = await state();
    actAs(people[name]);
    expect(
      await outcomeOf(
        markSeenAction({
          repertoireId: people.london,
          seenVersion: 1,
          playerId: people.rokas.id,
        }),
      ),
    ).toBeUndefined();
    expect(await state()).toEqual(before);
  });

  it('every action on an assignment the player has lost changes nothing', async () => {
    const { rimantas, rokas, london } = await cast();
    expect((await unlink(testDb(), rimantas.id, rokas.id, new Date())).ok).toBe(
      true,
    );
    const before = await state();
    actAs(rokas);
    expect(
      await outcomeOf(pauseAction({ paused: false }, pauseForm(london, true))),
    ).toEqual({ paused: false, refusal: NOT_ASSIGNED });
    expect(
      await outcomeOf(forkAction({}, formOf({ repertoireId: london }))),
    ).toEqual({ refusal: NOT_ASSIGNED });
    expect(
      await outcomeOf(
        setPersonalNoteAction({ repertoireId: london, moveKey: D4, text: '' }),
      ),
    ).toEqual({ ok: false, refusal: NOT_ASSIGNED });
    expect(
      await outcomeOf(markSeenAction({ repertoireId: london, seenVersion: 1 })),
    ).toBeUndefined();
    expect(await state()).toEqual(before);
  });

  it('a note on a move that is not in the assigned repertoire is refused', async () => {
    const { rokas, london } = await cast();
    const before = await state();
    actAs(rokas);
    expect(
      await outcomeOf(
        setPersonalNoteAction({
          repertoireId: london,
          moveKey: E4,
          text: 'Ne mano ėjimas',
        }),
      ),
    ).toEqual({ ok: false, refusal: NOT_ASSIGNED });
    expect(await state()).toEqual(before);
  });

  it('signed out, every action sends the visitor to sign-in', async () => {
    const { london } = await cast();
    const before = await state();
    request.cookie = '';
    for (const act of [
      pauseAction({ paused: false }, pauseForm(london, true)),
      forkAction({}, formOf({ repertoireId: london })),
      setPersonalNoteAction({ repertoireId: london, moveKey: D4, text: '' }),
      markSeenAction({ repertoireId: london, seenVersion: 1 }),
    ])
      expect(await outcomeOf(act)).toEqual({ redirectedTo: '/prisijungti' });
    expect(await state()).toEqual(before);
  });
});

describe('forged playerId and coachId fields act for the session player only', () => {
  it('pauseAction pauses only the session player’s assignment', async () => {
    const { rimantas, rokas, gabija, taimanov } = await cast();
    actAs(gabija);
    expect(
      await outcomeOf(
        pauseAction(
          { paused: false },
          pauseForm(taimanov, true, {
            playerId: rokas.id,
            coachId: rimantas.id,
          }),
        ),
      ),
    ).toEqual({ paused: true });
    expect(await playerStates()).toEqual([
      {
        player: 'Gabija',
        repertoire: 'Taimanovas',
        paused: true,
        forked: false,
        seen_version: null,
      },
    ]);
  });

  it('forkAction forks for the session player only', async () => {
    const { rimantas, rokas, gabija, taimanov } = await cast();
    actAs(gabija);
    await outcomeOf(
      forkAction(
        {},
        formOf({
          repertoireId: taimanov,
          playerId: rokas.id,
          coachId: rimantas.id,
        }),
      ),
    );
    expect(await repertoireOwners()).toEqual([
      { owner: 'Gabija', name: 'Taimanovas' },
      { owner: 'Rimantas', name: 'Londono sistema' },
      { owner: 'Rimantas', name: 'Taimanovas' },
    ]);
    expect(await playerStates()).toEqual([
      {
        player: 'Gabija',
        repertoire: 'Taimanovas',
        paused: false,
        forked: true,
        seen_version: null,
      },
    ]);
  });

  it('setPersonalNoteAction writes only the session player’s note', async () => {
    const { rokas, gabija, taimanov } = await cast();
    actAs(gabija);
    expect(
      await outcomeOf(
        setPersonalNoteAction({
          repertoireId: taimanov,
          moveKey: E4,
          text: 'Gabijos pastaba',
          playerId: rokas.id,
        }),
      ),
    ).toEqual({ ok: true });
    expect(
      await sql.rows(
        `select a.display_name as player, r.name as repertoire, n.text
           from personal_notes n
           join accounts a on a.id = n.player_account_id
           join repertoires r on r.id = n.repertoire_id
          order by 1, 2`,
      ),
    ).toEqual([
      { player: 'Gabija', repertoire: 'Taimanovas', text: 'Gabijos pastaba' },
      { player: 'Rokas', repertoire: 'Londono sistema', text: ROKAS_NOTE },
    ]);
  });

  it('markSeenAction marks only the session player’s assignment seen', async () => {
    const { rokas, gabija, taimanov } = await cast();
    actAs(gabija);
    await outcomeOf(
      markSeenAction({
        repertoireId: taimanov,
        seenVersion: 1,
        playerId: rokas.id,
      }),
    );
    expect(await playerStates()).toEqual([
      {
        player: 'Gabija',
        repertoire: 'Taimanovas',
        paused: false,
        forked: false,
        seen_version: 1,
      },
    ]);
  });
});

describe('the coach’s comments on their own repertoire (R-102, R-47)', () => {
  it('are shown to the assigned player as coach notes', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    const data = await assignedRepertoireData(london);
    expect(data.coachName).toBe('Rimantas');
    expect(commentsOf(data.graph)).toContain('Solid');
  });

  it.each([
    ['a linked player it is not assigned to', 'gabija'],
    ['an account with no coach', 'jonas'],
  ] as const)('are shown to no one else: %s gets 404', async (_who, name) => {
    const people = await cast();
    const before = await state();
    actAs(people[name]);
    expect(await outcomeOf(assignedRepertoireData(people.london))).toEqual({
      notFound: true,
    });
    expect(await outcomeOf(repertoirePageData(people.london))).toEqual({
      notFound: true,
    });
    expect(await state()).toEqual(before);
  });

  it('stay with the player’s fork, read-only, and with no one else', async () => {
    const { rokas, gabija, london } = await cast();
    actAs(rokas);
    const forked = await outcomeOf(
      forkAction({}, formOf({ repertoireId: london })),
    );
    const forkId = await rokasFork();
    expect(forked).toEqual({ redirectedTo: repertoireRoute(forkId) });
    const fork = await repertoirePageData(forkId);
    expect(fork.forkNotes).toContainEqual(
      expect.objectContaining({ text: 'Solid', coachName: 'Rimantas' }),
    );
    const before = await state();
    actAs(gabija);
    expect(await outcomeOf(repertoirePageData(forkId))).toEqual({
      notFound: true,
    });
    expect(await state()).toEqual(before);
  });
});
