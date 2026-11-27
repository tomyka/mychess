// Access to assigned repertoires (S5 Task C5, plan decisions 11 and 12).
// The assigned page answers 404 to anyone the repertoire is not assigned to
// now, and the player's actions on it act only for the session account:
// someone else's ids and forged playerId or coachId fields change nothing.
// The coach's assign, unassign and deadline actions act only on the session
// coach's own repertoires, links, groups and assignments; the fork offer
// answers and Today's lists only on the session player's own.
// Every refusal is checked against the whole assignment state of the
// database, before and after.
import { moveKey, START_KEY } from '@mychess/chess';
import {
  assign,
  leaveGroup,
  listPersonalNotes,
  setPersonalNote,
  stopCoaching,
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
} from '../../src/app/repertoires/assigned/[id]/actions';
import AssignedRepertoireLayout from '../../src/app/repertoires/assigned/[id]/layout';
import AssignedRepertoirePage from '../../src/app/repertoires/assigned/[id]/page';
import { savePersonalNoteAction } from '../../src/app/repertoires/[id]/actions';
import {
  assignAction,
  clearDeadlineAction,
  setDeadlineAction,
  unassignAction,
} from '../../src/app/repertoires/[id]/assign-actions';
import {
  acceptForkOfferAction,
  declineForkOfferAction,
} from '../../src/app/fork-offer-actions';
import { repertoireRoute } from '../../src/lib/routes';
import {
  assignedRepertoireData,
  myAssignedRepertoires,
  todayAssignments,
} from '../../src/server/assignment-pages';
import { coachAssignData } from '../../src/server/coach-assignments';
import { sharedRepertoireData } from '../../src/server/coach-pages';
import {
  myRepertoires,
  repertoirePageData,
} from '../../src/server/repertoires';
import { requireOnboarded } from '../../src/server/session';
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
import {
  LONDON,
  seedRepertoire,
  seedRepertoireRows,
  TAIMANOV,
} from './support/repertoires';

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

/** Rokas's personal note on his fork alone. */
const FORK_NOTE = 'Rokas: tik mano kopijoje';

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
      notes: { [D4]: ROKAS_NOTE },
      paused: false,
    });
    expect(await assignedRepertoireData(taimanov)).toMatchObject({
      repertoire: { id: taimanov, name: 'Taimanovas', side: 'black' },
      coachName: 'Rimantas',
      notes: {},
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

  // The layout decides before the page's loading.tsx streams, so these
  // answer 404, not 200 (#331).
  it('in its layout, before the page streams: not assigned, foreign or malformed is not found', async () => {
    const people = await cast();
    const openLayout = (id: string): Promise<unknown> =>
      outcomeOf(
        AssignedRepertoireLayout({
          params: Promise.resolve({ id }),
          children: 'the page',
        }),
      );
    actAs(people.gabija);
    expect(await openLayout(people.london)).toEqual({ notFound: true });
    expect(await openLayout('not-a-uuid')).toEqual({ notFound: true });
    actAs(people.rimantas);
    expect(await openLayout(people.london)).toEqual({ notFound: true });
    actAs(people.rokas);
    expect(
      await AssignedRepertoireLayout({
        params: Promise.resolve({ id: people.london }),
        children: 'the page',
      }),
    ).toMatchObject({ props: { children: 'the page' } });
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
    expect(await openPage(london)).toEqual({ redirectedTo: '/sign-in' });
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
      expect(await outcomeOf(act)).toEqual({ redirectedTo: '/sign-in' });
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

/** Every personal note as owner, repertoire, move key and text. */
const personalNoteRows = (): Promise<unknown[]> =>
  sql.rows(
    `select a.display_name as player, r.name as repertoire, n.move_key, n.text
       from personal_notes n
       join accounts a on a.id = n.player_account_id
       join repertoires r on r.id = n.repertoire_id
      order by 1, 2, 3`,
  );

describe('savePersonalNoteAction on an assigned repertoire (R-21, Q26)', () => {
  it('saves the assigned player’s own note on the coach’s live repertoire', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    expect(
      await outcomeOf(
        savePersonalNoteAction({
          repertoireId: london,
          moveKey: D4,
          text: 'Rokas: nauja',
        }),
      ),
    ).toEqual({ ok: true });
    expect(await personalNoteRows()).toEqual([
      {
        player: 'Rokas',
        repertoire: 'Londono sistema',
        move_key: D4,
        text: 'Rokas: nauja',
      },
    ]);
  });

  it.each([
    [
      'after the unlink',
      async ({ rimantas, rokas }: Cast) => {
        expect(
          (await unlink(testDb(), rimantas.id, rokas.id, new Date())).ok,
        ).toBe(true);
      },
    ],
    [
      'after the player forked it',
      async ({ rokas, london }: Cast) => {
        actAs(rokas);
        await outcomeOf(forkAction({}, formOf({ repertoireId: london })));
        await rokasFork();
      },
    ],
  ])(
    'refuses the player’s note %s (repertoire.notFound) and writes nothing',
    async (_when, lose) => {
      const people = await cast();
      await lose(people);
      const before = await state();
      actAs(people.rokas);
      for (const text of ['Rokas: po to', ''])
        expect(
          await outcomeOf(
            savePersonalNoteAction({
              repertoireId: people.london,
              moveKey: D4,
              text,
            }),
          ),
        ).toEqual({ ok: false, refusal: 'repertoire.notFound' });
      expect(await state()).toEqual(before);
    },
  );

  it('refuses an account it is not assigned to and writes nothing', async () => {
    const { gabija, jonas, london } = await cast();
    const before = await state();
    for (const who of [gabija, jonas]) {
      actAs(who);
      expect(
        await outcomeOf(
          savePersonalNoteAction({
            repertoireId: london,
            moveKey: D4,
            text: 'Svetima',
          }),
        ),
      ).toEqual({ ok: false, refusal: 'repertoire.notFound' });
    }
    expect(await state()).toEqual(before);
  });

  it('keeps the owning coach’s note under the coach, never shown to the player', async () => {
    const { rimantas, rokas, london } = await cast();
    const coachText = 'Rimantas: tik man';
    actAs(rimantas);
    expect(
      await outcomeOf(
        savePersonalNoteAction({
          repertoireId: london,
          moveKey: D4,
          text: coachText,
        }),
      ),
    ).toEqual({ ok: true });
    expect(await personalNoteRows()).toEqual([
      {
        player: 'Rimantas',
        repertoire: 'Londono sistema',
        move_key: D4,
        text: coachText,
      },
      {
        player: 'Rokas',
        repertoire: 'Londono sistema',
        move_key: D4,
        text: ROKAS_NOTE,
      },
    ]);
    const before = await state();
    expect(await listPersonalNotes(testDb(), rokas.id, london)).toEqual({
      [D4]: ROKAS_NOTE,
    });
    actAs(rokas);
    const assigned = await assignedRepertoireData(london);
    expect(assigned.notes).toEqual({ [D4]: ROKAS_NOTE });
    expect(JSON.stringify(assigned)).not.toContain(coachText);
    expect(await state()).toEqual(before);
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

  it('the assigning coach never sees the player’s fork, only that it was forked (R-43)', async () => {
    const { rimantas, rokas, london } = await cast();
    actAs(rokas);
    await outcomeOf(forkAction({}, formOf({ repertoireId: london })));
    const forkId = await rokasFork();
    const forkNote = await setPersonalNote(testDb(), {
      playerId: rokas.id,
      repertoireId: forkId,
      moveKey: D4,
      text: FORK_NOTE,
      now: new Date(),
    });
    expect(forkNote.ok).toBe(true);
    const before = await state();
    actAs(rimantas);
    expect(await outcomeOf(repertoirePageData(forkId))).toEqual({
      notFound: true,
    });
    expect(await outcomeOf(sharedRepertoireData(rokas.id, forkId))).toEqual({
      notFound: true,
    });
    const panel = await coachAssignData(london);
    expect(panel.panel?.assignments).toMatchObject([
      {
        target: { kind: 'player', id: rokas.id, name: 'Rokas' },
        players: [
          {
            playerId: rokas.id,
            displayName: 'Rokas',
            badges: { forked: true },
          },
        ],
      },
    ]);
    expect(panel.panel?.assignments[0]?.players).toHaveLength(1);
    // Nor the fork's progress (R-155): the access-checked read withholds it.
    expect(panel.panel?.standings).toEqual(new Map([[rokas.id, null]]));
    // A Map stringifies to {}: the standings are checked as entries too.
    const shown = JSON.stringify([
      panel,
      [...(panel.panel?.standings ?? new Map())],
    ]);
    expect(shown).not.toContain(forkId);
    expect(shown).not.toContain(FORK_NOTE);
    expect(shown).not.toContain(ROKAS_NOTE);
    expect(await state()).toEqual(before);
  });
});

/** Dovydas: a second coach, with his own group and London assigned to it. */
interface SecondCoach {
  readonly dovydas: Person;
  /** "Dovydo grupė", with no members. */
  readonly dovydasGroup: string;
  /** Dovydas's London, assigned to his group. */
  readonly dovydasLondon: string;
  /** That assignment. */
  readonly dovydasAssignment: string;
}

async function secondCoach(): Promise<SecondCoach> {
  const dovydas = await coachPerson(sql, 'dovydas@example.lt', 'Dovydas');
  const dovydasGroup = await groupOf(dovydas.id, 'Dovydo grupė');
  const dovydasLondon = await seedRepertoire(testDb(), 'dovydas@example.lt', {
    pgn: LONDON,
    side: 'white',
    name: 'Dovydo Londonas',
  });
  await assignTo(dovydas.id, dovydasLondon, {
    kind: 'group',
    groupId: dovydasGroup,
  });
  const dovydasAssignment = await oneId(
    'select id from assignments where group_id = $1',
    [dovydasGroup],
  );
  return { dovydas, dovydasGroup, dovydasLondon, dovydasAssignment };
}

/** The assign panel's form: the repertoire, the picked target, the deadline. */
const assignForm = (
  repertoireId: string,
  target: string,
  deadline = '',
  extra: Readonly<Record<string, string>> = {},
): FormData => formOf({ repertoireId, target, deadline, ...extra });

/** Every assignment by coach, repertoire, target and deadline. */
const assignmentRows = (): Promise<unknown[]> =>
  sql.rows(
    `select c.display_name as coach, r.name as repertoire,
            coalesce(p.display_name, g.name) as target,
            s.deadline::text as deadline
       from assignments s
       join accounts c on c.id = s.coach_id
       join repertoires r on r.id = s.repertoire_id
       left join accounts p on p.id = s.player_id
       left join groups g on g.id = s.group_id
      order by 1, 2, 3`,
  );

/** The assignments the cast starts with. */
const CAST_ASSIGNMENTS = [
  {
    coach: 'Rimantas',
    repertoire: 'Londono sistema',
    target: 'Rokas',
    deadline: null,
  },
  {
    coach: 'Rimantas',
    repertoire: 'Taimanovas',
    target: 'Gabija',
    deadline: null,
  },
  {
    coach: 'Rimantas',
    repertoire: 'Taimanovas',
    target: 'Šeštadienio grupė',
    deadline: null,
  },
];

describe('assignAction', () => {
  it('assigns the coach’s own repertoire to a linked player', async () => {
    const { rimantas, gabija, london } = await cast();
    actAs(rimantas);
    expect(
      await outcomeOf(
        assignAction(
          {},
          assignForm(london, `player:${gabija.id}`, '2026-12-31'),
        ),
      ),
    ).toEqual({ saved: 1 });
    expect(await assignmentRows()).toEqual([
      {
        coach: 'Rimantas',
        repertoire: 'Londono sistema',
        target: 'Gabija',
        deadline: '2026-12-31',
      },
      ...CAST_ASSIGNMENTS,
    ]);
  });

  it('refuses another account’s repertoire (assignment.notFound)', async () => {
    const people = await cast();
    const { dovydasLondon } = await secondCoach();
    const before = await state();
    actAs(people.rimantas);
    expect(
      await outcomeOf(
        assignAction(
          {},
          assignForm(dovydasLondon, `player:${people.rokas.id}`),
        ),
      ),
    ).toEqual({ refusal: 'assignment.notFound' });
    expect(await state()).toEqual(before);
  });

  it('refuses a player the coach is not linked to (assignment.notLinked)', async () => {
    const { rimantas, jonas, london } = await cast();
    const before = await state();
    actAs(rimantas);
    expect(
      await outcomeOf(
        assignAction({}, assignForm(london, `player:${jonas.id}`)),
      ),
    ).toEqual({ refusal: 'assignment.notLinked' });
    expect(await state()).toEqual(before);
  });

  it('refuses another coach’s group (assignment.groupNotFound)', async () => {
    const { rimantas, london } = await cast();
    const { dovydasGroup } = await secondCoach();
    const before = await state();
    actAs(rimantas);
    expect(
      await outcomeOf(
        assignAction({}, assignForm(london, `group:${dovydasGroup}`)),
      ),
    ).toEqual({ refusal: 'assignment.groupNotFound' });
    expect(await state()).toEqual(before);
  });

  it('refuses a malformed form and changes nothing', async () => {
    const { rimantas, rokas, group, london } = await cast();
    const before = await state();
    actAs(rimantas);
    for (const [form, refusal] of [
      [assignForm('nėra', `player:${rokas.id}`), 'assignment.notFound'],
      [assignForm(london, 'player:'), 'assignment.notLinked'],
      [assignForm(london, 'group:nėra'), 'assignment.groupNotFound'],
      [assignForm(london, ''), 'assignment.panel.pickTarget'],
      [
        assignForm(london, `group:${group}`, 'rytoj'),
        'assignment.deadlineInvalid',
      ],
    ] as const)
      expect(await outcomeOf(assignAction({}, form))).toEqual({ refusal });
    expect(await state()).toEqual(before);
  });

  it('a coachId in the form never assigns as that coach', async () => {
    const people = await cast();
    const { dovydas } = await secondCoach();
    const before = await state();
    actAs(dovydas);
    expect(
      await outcomeOf(
        assignAction(
          {},
          assignForm(people.london, `player:${people.gabija.id}`, '', {
            coachId: people.rimantas.id,
          }),
        ),
      ),
    ).toEqual({ refusal: 'assignment.notFound' });
    expect(await state()).toEqual(before);
  });
});

/** The actions on one existing assignment, each taking its form. */
const ASSIGNMENT_ACTS = {
  unassign: (form: FormData) => unassignAction({}, form),
  deadline: (form: FormData) => setDeadlineAction({}, form),
  clear: (form: FormData) => clearDeadlineAction({}, form),
} as const;

describe('unassignAction, setDeadlineAction and clearDeadlineAction', () => {
  it('end and move the coach’s own assignment', async () => {
    const { rimantas, rokas, london } = await cast();
    const assignment = await assignmentId(london, rokas.id);
    actAs(rimantas);
    expect(
      await outcomeOf(
        setDeadlineAction(
          {},
          formOf({ assignmentId: assignment, deadline: '2026-12-31' }),
        ),
      ),
    ).toEqual({ saved: 1 });
    expect(await assignmentRows()).toContainEqual({
      coach: 'Rimantas',
      repertoire: 'Londono sistema',
      target: 'Rokas',
      deadline: '2026-12-31',
    });
    expect(
      await outcomeOf(unassignAction({}, formOf({ assignmentId: assignment }))),
    ).toEqual({ saved: 1 });
    expect(await assignmentRows()).toEqual(CAST_ASSIGNMENTS.slice(1));
  });

  it('clearDeadlineAction clears only the deadline of the assignment named', async () => {
    const { rimantas, rokas, gabija, london, taimanov } = await cast();
    const rokasLondon = await assignmentId(london, rokas.id);
    const gabijaTaimanov = await assignmentId(taimanov, gabija.id);
    actAs(rimantas);
    for (const id of [rokasLondon, gabijaTaimanov])
      await outcomeOf(
        setDeadlineAction(
          {},
          formOf({ assignmentId: id, deadline: '2026-12-31' }),
        ),
      );
    expect(
      await outcomeOf(
        clearDeadlineAction({}, formOf({ assignmentId: rokasLondon })),
      ),
    ).toEqual({ saved: 1 });
    expect(await assignmentRows()).toEqual([
      CAST_ASSIGNMENTS[0],
      { ...CAST_ASSIGNMENTS[1], deadline: '2026-12-31' },
      CAST_ASSIGNMENTS[2],
    ]);
  });

  it('setDeadlineAction refuses an empty date (assignment.deadlineInvalid) and changes nothing', async () => {
    const people = await cast();
    const { dovydas } = await secondCoach();
    const assignment = await assignmentId(people.london, people.rokas.id);
    const before = await state();
    for (const who of [people.rimantas, dovydas]) {
      actAs(who);
      for (const deadline of ['', 'rytoj', '2026-02-30'])
        expect(
          await outcomeOf(
            setDeadlineAction(
              {},
              formOf({ assignmentId: assignment, deadline }),
            ),
          ),
        ).toEqual({ refusal: 'assignment.deadlineInvalid' });
    }
    expect(await state()).toEqual(before);
  });

  it.each([
    ['unassignAction', 'unassign'],
    ['setDeadlineAction', 'deadline'],
    ['clearDeadlineAction', 'clear'],
  ] as const)(
    '%s with another coach’s assignment id changes nothing, coachId or not',
    async (_action, which) => {
      const people = await cast();
      const { dovydas } = await secondCoach();
      const assignment = await assignmentId(people.london, people.rokas.id);
      actAs(people.rimantas);
      await outcomeOf(
        setDeadlineAction(
          {},
          formOf({ assignmentId: assignment, deadline: '2026-12-31' }),
        ),
      );
      const before = await state();
      actAs(dovydas);
      for (const extra of [{}, { coachId: people.rimantas.id }]) {
        const form = formOf({
          assignmentId: assignment,
          deadline: '2027-01-31',
          ...extra,
        });
        expect(await outcomeOf(ASSIGNMENT_ACTS[which](form))).toEqual({
          refusal: 'assignment.notFound',
        });
      }
      expect(await state()).toEqual(before);
    },
  );

  it('refuse a malformed or unknown id and change nothing', async () => {
    const { rimantas } = await cast();
    const before = await state();
    actAs(rimantas);
    for (const id of ['nėra', '', randomUUID()]) {
      const form = formOf({ assignmentId: id, deadline: '2026-12-31' });
      for (const act of Object.values(ASSIGNMENT_ACTS))
        expect(await outcomeOf(act(form))).toEqual({
          refusal: 'assignment.notFound',
        });
    }
    expect(await state()).toEqual(before);
  });
});

/** Each assign action, aimed at Rimantas's London and its assignment to Rokas. */
async function everyAssignAction(
  people: Cast,
): Promise<(() => Promise<unknown>)[]> {
  const assignment = await assignmentId(people.london, people.rokas.id);
  return [
    () =>
      assignAction({}, assignForm(people.london, `player:${people.gabija.id}`)),
    () => unassignAction({}, formOf({ assignmentId: assignment })),
    () =>
      setDeadlineAction(
        {},
        formOf({ assignmentId: assignment, deadline: '2026-12-31' }),
      ),
    () => clearDeadlineAction({}, formOf({ assignmentId: assignment })),
  ];
}

describe('the assign actions without Coach mode or signed out', () => {
  it('send a player without Coach mode to settings and change nothing', async () => {
    const people = await cast();
    const before = await state();
    actAs(people.rokas);
    for (const act of await everyAssignAction(people))
      expect(await outcomeOf(act())).toEqual({ redirectedTo: '/settings' });
    expect(await state()).toEqual(before);
  });

  it('send a coach who switched Coach mode off to settings, on their own repertoire too', async () => {
    await cast();
    const { dovydas, dovydasGroup, dovydasLondon, dovydasAssignment } =
      await secondCoach();
    expect((await stopCoaching(testDb(), dovydas.id, new Date())).ok).toBe(
      true,
    );
    const before = await state();
    actAs(dovydas);
    const acts = [
      () =>
        assignAction({}, assignForm(dovydasLondon, `group:${dovydasGroup}`)),
      () => unassignAction({}, formOf({ assignmentId: dovydasAssignment })),
      () =>
        setDeadlineAction(
          {},
          formOf({ assignmentId: dovydasAssignment, deadline: '2026-12-31' }),
        ),
      () =>
        clearDeadlineAction({}, formOf({ assignmentId: dovydasAssignment })),
    ];
    for (const act of acts)
      expect(await outcomeOf(act())).toEqual({ redirectedTo: '/settings' });
    expect(await state()).toEqual(before);
  });

  it('send a signed-out visitor to sign-in and change nothing', async () => {
    const people = await cast();
    const before = await state();
    request.cookie = '';
    for (const act of await everyAssignAction(people))
      expect(await outcomeOf(act())).toEqual({ redirectedTo: '/sign-in' });
    expect(await state()).toEqual(before);
  });
});

/** Rimantas unassigns Rokas's London: the id of Rokas's open offer. */
async function rokasOffer(people: Cast): Promise<string> {
  const done = await unassign(
    testDb(),
    {
      coachId: people.rimantas.id,
      assignmentId: await assignmentId(people.london, people.rokas.id),
    },
    new Date(),
  );
  if (!done.ok) throw new Error(`not unassigned: ${done.refusal.reason}`);
  return oneId('select id from fork_offers where player_id = $1', [
    people.rokas.id,
  ]);
}

describe('a fork the player asks for at the R-162 limit (R-163)', () => {
  const AT_LIMIT = { refusal: 'repertoire.limit', limit: 50 };

  it('forking an assignment is refused with the limit and changes nothing', async () => {
    const { rokas, london } = await cast();
    await seedRepertoireRows(sql, rokas.id, 50);
    const before = await state();
    actAs(rokas);
    expect(
      await outcomeOf(forkAction({}, formOf({ repertoireId: london }))),
    ).toEqual(AT_LIMIT);
    expect(await state()).toEqual(before);
  });

  it('keeping a copy from an offer is refused with the limit, and the offer stays', async () => {
    const people = await cast();
    const offer = await rokasOffer(people);
    await seedRepertoireRows(sql, people.rokas.id, 50);
    const before = await state();
    actAs(people.rokas);
    expect(
      await outcomeOf(acceptForkOfferAction({}, formOf({ offerId: offer }))),
    ).toEqual(AT_LIMIT);
    expect(await state()).toEqual(before);
    expect(await sessionToday()).toMatchObject({ offers: [{ id: offer }] });
  });
});

describe('the fork offer answers', () => {
  it('keeping a copy goes to the new fork, and the offer leaves Today', async () => {
    const people = await cast();
    const offer = await rokasOffer(people);
    actAs(people.rokas);
    expect(await sessionToday()).toMatchObject({
      offers: [{ id: offer, name: 'Londono sistema', coachName: 'Rimantas' }],
    });
    expect(
      await outcomeOf(acceptForkOfferAction({}, formOf({ offerId: offer }))),
    ).toEqual({ redirectedTo: repertoireRoute(await rokasFork()) });
    expect((await sessionToday()).offers).toEqual([]);
  });

  it('declining takes the offer off Today, and it cannot be kept after', async () => {
    const people = await cast();
    const offer = await rokasOffer(people);
    actAs(people.rokas);
    expect(
      await outcomeOf(declineForkOfferAction({}, formOf({ offerId: offer }))),
    ).toEqual({});
    expect((await sessionToday()).offers).toEqual([]);
    const before = await state();
    expect(
      await outcomeOf(acceptForkOfferAction({}, formOf({ offerId: offer }))),
    ).toEqual({ refusal: 'forkOffer.notOpen' });
    expect(await state()).toEqual(before);
  });

  it.each([
    ['a linked player it is not for', 'gabija'],
    ['an account with no coach', 'jonas'],
    ['the coach who made it', 'rimantas'],
  ] as const)(
    'with someone else’s offer id change nothing, as %s, playerId or not',
    async (_who, name) => {
      const people = await cast();
      const offer = await rokasOffer(people);
      const before = await state();
      actAs(people[name]);
      for (const extra of [{}, { playerId: people.rokas.id }]) {
        const form = formOf({ offerId: offer, ...extra });
        expect(await outcomeOf(acceptForkOfferAction({}, form))).toEqual({
          refusal: 'forkOffer.notOpen',
        });
        expect(await outcomeOf(declineForkOfferAction({}, form))).toEqual({
          refusal: 'forkOffer.notOpen',
        });
      }
      expect(await state()).toEqual(before);
    },
  );

  it('refuse a malformed or unknown offer id and change nothing', async () => {
    const people = await cast();
    await rokasOffer(people);
    const before = await state();
    actAs(people.rokas);
    for (const id of ['nėra', '', randomUUID()]) {
      const form = formOf({ offerId: id });
      expect(await outcomeOf(acceptForkOfferAction({}, form))).toEqual({
        refusal: 'forkOffer.notOpen',
      });
      expect(await outcomeOf(declineForkOfferAction({}, form))).toEqual({
        refusal: 'forkOffer.notOpen',
      });
    }
    expect(await state()).toEqual(before);
  });

  it('send a signed-out visitor to sign-in and change nothing', async () => {
    const people = await cast();
    const offer = await rokasOffer(people);
    const before = await state();
    request.cookie = '';
    const acts = [
      () => acceptForkOfferAction({}, formOf({ offerId: offer })),
      () => declineForkOfferAction({}, formOf({ offerId: offer })),
    ];
    for (const act of acts)
      expect(await outcomeOf(act())).toEqual({ redirectedTo: '/sign-in' });
    expect(await state()).toEqual(before);
  });
});

/**
 * The session account's assignments and offers, read as Today's page reads
 * them: the page's requireOnboarded, then todayAssignments for that account.
 */
async function sessionToday(): ReturnType<typeof todayAssignments> {
  return todayAssignments(await requireOnboarded());
}

/**
 * Today's lists for `who`: each assignment as "repertoire id (coach)" (its
 * row is named from the training snapshot), each offer as "name (coach)".
 */
async function todayNames(who: Person): Promise<unknown> {
  actAs(who);
  const today = await sessionToday();
  return {
    assigned: today.assigned.map(
      (one) => `${one.repertoireId} (${one.coachName})`,
    ),
    offers: today.offers.map((one) => `${one.name} (${one.coachName})`),
  };
}

describe('Today’s assignment facts and fork offers', () => {
  it('list only the session player’s own assignments and offers', async () => {
    const people = await cast();
    await secondCoach();
    await rokasOffer(people);
    const before = await state();
    expect(await todayNames(people.rokas)).toEqual({
      assigned: [`${people.taimanov} (Rimantas)`],
      offers: ['Londono sistema (Rimantas)'],
    });
    expect(await todayNames(people.gabija)).toEqual({
      assigned: [`${people.taimanov} (Rimantas)`],
      offers: [],
    });
    expect(await todayNames(people.jonas)).toEqual({
      assigned: [],
      offers: [],
    });
    expect(await todayNames(people.rimantas)).toEqual({
      assigned: [],
      offers: [],
    });
    expect(await state()).toEqual(before);
  });

  it('My repertoires lists the session player’s live assignments, individual and group, by side (#328)', async () => {
    const people = await cast();
    const listed = async (who: Person): Promise<unknown> => {
      actAs(who);
      return (await myAssignedRepertoires()).map(
        (one) => `${one.name} (${one.side}, ${one.coachName})`,
      );
    };
    expect(await listed(people.rokas)).toEqual([
      'Londono sistema (white, Rimantas)',
      'Taimanovas (black, Rimantas)',
    ]);
    expect(await listed(people.gabija)).toEqual([
      'Taimanovas (black, Rimantas)',
    ]);
    expect(await listed(people.jonas)).toEqual([]);
    expect(await listed(people.rimantas)).toEqual([]);
  });

  it('My repertoires labels the player’s fork with its coach, and sends no source id to the page (#328)', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    await outcomeOf(forkAction({}, formOf({ repertoireId: london })));
    const mine = await myRepertoires();
    expect(
      mine.map(({ name, forkCoachName }) => ({ name, forkCoachName })),
    ).toEqual([{ name: 'Londono sistema', forkCoachName: 'Rimantas' }]);
    expect(Object.keys(mine[0] ?? {})).not.toContain('forkedFrom');
    expect(JSON.stringify(mine)).not.toContain(london);
  });

  it('show the session player’s own pause, not another player’s', async () => {
    const people = await cast();
    actAs(people.gabija);
    await outcomeOf(
      pauseAction(
        { paused: false },
        pauseForm(people.taimanov, true, { playerId: people.rokas.id }),
      ),
    );
    expect((await sessionToday()).assigned).toMatchObject([
      { repertoireId: people.taimanov, badges: { paused: true } },
    ]);
    actAs(people.rokas);
    const rokas = await sessionToday();
    expect(rokas.assigned).toHaveLength(2);
    expect(
      rokas.assigned.find((one) => one.repertoireId === people.taimanov)?.badges
        .paused,
    ).toBe(false);
  });

  it('send a signed-out visitor to sign-in', async () => {
    await cast();
    request.cookie = '';
    expect(await outcomeOf(sessionToday())).toEqual({
      redirectedTo: '/sign-in',
    });
  });
});

/** A standing as the coach may see it: the counts and the flag, nothing else. */
const STANDING = z.strictObject({
  counts: z.strictObject({
    notStarted: z.number().int().min(0),
    skipped: z.number().int().min(0),
    due: z.number().int().min(0),
    learned: z.number().int().min(0),
  }),
  mastered: z.boolean(),
});

/**
 * An assignee as the Repertoire screen gets them: the standing and the
 * assignment status (deadline and flags), nothing else.
 */
const ASSIGNEE = z.strictObject({
  standing: STANDING,
  status: z
    .strictObject({
      deadline: z.iso.date().nullable(),
      overdue: z.boolean(),
      paused: z.boolean(),
      done: z.boolean(),
      forked: z.boolean(),
    })
    .nullable(),
});

describe('the assignees’ standings on the coach’s Repertoire screen (R-225, Q26)', () => {
  /** The session coach's standings of `repertoireId`, by player id. */
  async function standingsOf(
    repertoireId: string,
  ): Promise<ReadonlyMap<string, unknown>> {
    const data = await coachAssignData(repertoireId);
    if (data.panel === null) throw new Error('no panel in Coach mode');
    return data.panel.standings;
  }

  it('gives a live, linked assigned player their counts and nothing more', async () => {
    const { rimantas, rokas, gabija, taimanov } = await cast();
    const before = await state();
    actAs(rimantas);
    const standings = await standingsOf(taimanov);
    // Gabija has it alone, Rokas through the group: both linked and live.
    expect([...standings.keys()].sort()).toEqual([gabija.id, rokas.id].sort());
    for (const standing of standings.values()) {
      // Exactly the counts, the mastered flag and the status: no move, time or id.
      const shape = ASSIGNEE.safeParse(standing);
      expect(shape.success).toBe(true);
      // Nothing trained yet: every one of the Taimanov's own moves is new.
      expect(shape.data?.standing.counts.notStarted).toBeGreaterThan(0);
    }
    expect(await state()).toEqual(before);
  });

  it('gives a group player who unlinked no standing', async () => {
    const { rimantas, rokas, gabija, taimanov } = await cast();
    const done = await unlink(testDb(), rimantas.id, rokas.id, new Date());
    expect(done.ok).toBe(true);
    actAs(rimantas);
    const standings = await standingsOf(taimanov);
    // Whether or not the list still names him, his progress is withheld.
    expect(standings.get(rokas.id) ?? null).toBeNull();
    expect(ASSIGNEE.safeParse(standings.get(gabija.id)).success).toBe(true);
  });
});
