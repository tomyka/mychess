// The coach access suite (S4 Task A15, security checklist 1-4 on #233).
// Every coach page loader and every coach action is driven as a coach who
// is not linked, as an account without Coach mode, and signed out; and the
// access ends on the next request after an unlink from either side.
import { moveKey, START_KEY } from '@mychess/chess';
import {
  assign,
  createInvite,
  setPersonalNote,
  shareRepertoire,
} from '@mychess/db';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { unlinkCoachAction } from '../../src/app/nustatymai/coaching-actions';
import * as assignActions from '../../src/app/repertuarai/[id]/assign-actions';
import {
  assignAction,
  clearDeadlineAction,
  setDeadlineAction,
  unassignAction,
} from '../../src/app/repertuarai/[id]/assign-actions';
import { setSharesAction } from '../../src/app/repertuarai/[id]/sharing-actions';
import { forkAction } from '../../src/app/repertuarai/priskirti/[id]/actions';
import * as coachActions from '../../src/app/treneris/actions';
import {
  addMemberAction,
  createGroupAction,
  createInviteAction,
  deleteCoachNoteAction,
  deleteGroupAction,
  removeMemberAction,
  renameGroupAction,
  revokeInviteAction,
  saveCoachNoteAction,
  unlinkPlayerAction,
} from '../../src/app/treneris/actions';
import {
  coachGroupData,
  coachHomeData,
  coachPlayerData,
  sharedRepertoireData,
} from '../../src/server/coach-pages';
import { coachProgressData } from '../../src/server/coach-progress';
import { repertoirePageData } from '../../src/server/repertoires';
import { TEST_ENV_VARS } from './support/auth';
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
import { LONDON, seedRepertoire } from './support/repertoires';

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

// createInviteAction builds its link from BETTER_AUTH_URL.
beforeEach(() => {
  for (const [name, value] of Object.entries(TEST_ENV_VARS))
    vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const APP = join(dirname(fileURLToPath(import.meta.url)), '../../src/app');

/** The people and rows every case starts from. */
interface Ids {
  /** Coach, linked to Rokas; Rokas is in his group. */
  readonly rimantas: Person;
  readonly rokas: Person;
  /** Coach, linked only to Gabija, who is in his group. */
  readonly dovydas: Person;
  readonly gabija: Person;
  /** Rimantas's "Šeštadienio grupė". */
  readonly group: string;
  /** Dovydas's group. */
  readonly dovydasGroup: string;
  /** An open personal invite of Rimantas. */
  readonly invite: string;
  /** Rokas's London, shared with Rimantas; Rokas's note on 1. d4. */
  readonly london: string;
  /** Rokas's other repertoire, shared with nobody. */
  readonly unshared: string;
  /** Rimantas's own repertoire, assigned to his group. */
  readonly assigned: string;
  /** That assignment. */
  readonly assignment: string;
}

async function openInvite(coachId: string): Promise<string> {
  const made = await createInvite(testDb(), {
    coachId,
    kind: 'personal',
    groupId: null,
    now: new Date(),
  });
  if (!made.ok) throw new Error(`no invite: ${made.refusal.reason}`);
  return made.value.inviteId;
}

const D4 = moveKey(START_KEY, 'd4');

/** The text of Rokas's personal note, which no coach may ever read (R-21). */
const PERSONAL_NOTE = 'Rokas: tik man';

/** Rokas's London shared with Rimantas, with Rokas's note, and an unshared one. */
async function rokasRepertoires(
  rokas: Person,
  rimantas: Person,
): Promise<{ london: string; unshared: string }> {
  const seed = (name: string) =>
    seedRepertoire(testDb(), 'rokas@example.lt', {
      pgn: LONDON,
      side: 'white',
      name,
    });
  const london = await seed('Londono sistema');
  const unshared = await seed('Privatus');
  const now = new Date();
  const shared = await shareRepertoire(testDb(), {
    ownerId: rokas.id,
    repertoireId: london,
    coachId: rimantas.id,
    now,
  });
  const noted = await setPersonalNote(testDb(), {
    playerId: rokas.id,
    repertoireId: london,
    moveKey: D4,
    text: PERSONAL_NOTE,
    now,
  });
  if (!shared.ok || !noted.ok) throw new Error('no shared London');
  return { london, unshared };
}

const assignmentRowsSchema = z.tuple([z.object({ id: z.uuid() })]);

/** Rimantas's own London, assigned to his group; it and the assignment. */
async function rimantasAssignment(
  rimantas: Person,
  groupId: string,
): Promise<{ assigned: string; assignment: string }> {
  const assigned = await seedRepertoire(testDb(), 'rimantas@example.lt', {
    pgn: LONDON,
    side: 'white',
    name: 'Rimanto Londonas',
  });
  const made = await assign(
    testDb(),
    {
      coachId: rimantas.id,
      repertoireId: assigned,
      target: { kind: 'group', groupId },
      deadline: null,
    },
    new Date(),
  );
  if (!made.ok) throw new Error(`not assigned: ${made.refusal.reason}`);
  const [row] = assignmentRowsSchema.parse(
    await sql.rows('select id from assignments where repertoire_id = $1', [
      assigned,
    ]),
  );
  return { assigned, assignment: row.id };
}

async function setUp(): Promise<Ids> {
  const rimantas = await coachPerson(
    sql,
    'rimantas@example.lt',
    'Rimantas Vaitkus',
  );
  const dovydas = await coachPerson(sql, 'dovydas@example.lt', 'Dovydas');
  const rokas = await person(sql, 'rokas@example.lt', 'Rokas Petrauskas');
  const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
  const group = await groupOf(rimantas.id, 'Šeštadienio grupė');
  const dovydasGroup = await groupOf(dovydas.id, 'Dovydo grupė');
  await link(rimantas.id, rokas.id, group);
  await link(dovydas.id, gabija.id, dovydasGroup);
  const invite = await openInvite(rimantas.id);
  const { london, unshared } = await rokasRepertoires(rokas, rimantas);
  const { assigned, assignment } = await rimantasAssignment(rimantas, group);
  return {
    rimantas,
    rokas,
    dovydas,
    gabija,
    group,
    dovydasGroup,
    invite,
    london,
    unshared,
    assigned,
    assignment,
  };
}

// Every page under src/app/treneris has one entry; the guard below fails
// when a page is added without one (plan decision 14).
const COACH_PAGES: Readonly<Record<string, (ids: Ids) => Promise<unknown>>> = {
  treneris: () => coachHomeData(),
  'treneris/zaidejai/[playerId]': (ids) => coachPlayerData(ids.rokas.id),
  'treneris/grupes/[groupId]': (ids) => coachGroupData(ids.group),
  'treneris/zaidejai/[playerId]/repertuarai/[repertoireId]': (ids) =>
    sharedRepertoireData(ids.rokas.id, ids.london),
  'treneris/zaidejai/[playerId]/pazanga/[repertoireId]': (ids) =>
    coachProgressData(ids.rokas.id, ids.london),
};

/** The loaders that take a player or a group: Rimantas's ones. */
const PLAYER_AND_GROUP_PAGES = Object.entries(COACH_PAGES).filter(
  ([page]) => page !== 'treneris',
);

// Every coach action, each aimed at Rimantas's player, group or invite.
// The guard below fails when an action is added without one.
const COACH_ACTIONS: Readonly<
  Record<keyof typeof coachActions, (ids: Ids) => Promise<unknown>>
> = {
  createGroupAction: () =>
    createGroupAction({}, formOf({ name: 'Nauja grupė' })),
  renameGroupAction: (ids) =>
    renameGroupAction({}, formOf({ groupId: ids.group, name: 'Pagrobta' })),
  deleteGroupAction: (ids) => deleteGroupAction(formOf({ groupId: ids.group })),
  addMemberAction: (ids) =>
    addMemberAction(
      {},
      formOf({ groupId: ids.group, playerId: ids.gabija.id }),
    ),
  removeMemberAction: (ids) =>
    removeMemberAction(
      {},
      formOf({ groupId: ids.group, playerId: ids.rokas.id }),
    ),
  unlinkPlayerAction: (ids) =>
    unlinkPlayerAction({}, formOf({ playerId: ids.rokas.id })),
  createInviteAction: (ids) =>
    createInviteAction({}, formOf({ kind: 'group', groupId: ids.group })),
  revokeInviteAction: (ids) =>
    revokeInviteAction({}, formOf({ inviteId: ids.invite })),
  saveCoachNoteAction: (ids) =>
    saveCoachNoteAction({
      playerId: ids.rokas.id,
      repertoireId: ids.london,
      moveKey: D4,
      text: 'Trenerio pastaba',
    }),
  deleteCoachNoteAction: (ids) =>
    deleteCoachNoteAction({
      playerId: ids.rokas.id,
      repertoireId: ids.london,
      moveKey: D4,
    }),
};

// The assign panel's actions (S5 C2), each aimed at Rimantas's own
// repertoire and its assignment to his group.
const ASSIGN_ACTIONS: Readonly<
  Record<keyof typeof assignActions, (ids: Ids) => Promise<unknown>>
> = {
  assignAction: (ids) =>
    assignAction(
      {},
      formOf({
        repertoireId: ids.assigned,
        target: `player:${ids.rokas.id}`,
        deadline: '',
      }),
    ),
  unassignAction: (ids) =>
    unassignAction({}, formOf({ assignmentId: ids.assignment })),
  setDeadlineAction: (ids) =>
    setDeadlineAction(
      {},
      formOf({ assignmentId: ids.assignment, deadline: '2026-12-31' }),
    ),
  clearDeadlineAction: (ids) =>
    clearDeadlineAction({}, formOf({ assignmentId: ids.assignment })),
};

// Every 'use server' module under src that calls requireCoach, by its path
// from src, with its exports and the table that drives each one. The guard
// below fails when such a module, or an action in one, has no entry.
const COACH_ACTION_MODULES: Readonly<
  Record<
    string,
    {
      readonly exports: object;
      readonly table: Readonly<Record<string, unknown>>;
    }
  >
> = {
  'app/treneris/actions.ts': { exports: coachActions, table: COACH_ACTIONS },
  'app/repertuarai/[id]/assign-actions.ts': {
    exports: assignActions,
    table: ASSIGN_ACTIONS,
  },
};

/** Every driven coach action. */
const ALL_COACH_ACTIONS = { ...COACH_ACTIONS, ...ASSIGN_ACTIONS };

/** The actions that name something of Rimantas's (all but a new group). */
const ACTIONS_ON_RIMANTAS = Object.entries(ALL_COACH_ACTIONS).filter(
  ([action]) => action !== 'createGroupAction',
);

const SRC = join(APP, '..');

/** The 'use server' modules under src that call requireCoach, from src. */
function coachActionModules(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .filter((file) => {
      const source = readFileSync(join(SRC, file), 'utf8');
      return (
        /^['"]use server['"];?\s*$/m.test(source) &&
        /\brequireCoach\b/.test(source)
      );
    })
    .map((file) => relative(SRC, join(SRC, file)).split(sep).join('/'));
}

/** Every row of the coaching tables, to compare before and after. */
async function coachingRows(): Promise<unknown> {
  return {
    links: await sql.rows('select * from coach_links order by 1, 2'),
    members: await sql.rows('select * from group_members order by 1, 2'),
    groups: await sql.rows('select * from groups order by 1'),
    invites: await sql.rows('select * from invites order by 1'),
    shares: await sql.rows('select * from repertoire_shares order by 1, 3'),
    notes: await sql.rows('select * from coach_notes order by 1'),
    assignments: await sql.rows('select * from assignments order by 1'),
    assignmentPlayers: await sql.rows(
      'select * from assignment_players order by 1, 2',
    ),
    offers: await sql.rows('select * from fork_offers order by 1'),
  };
}

/** Coach-player pairs by display name. */
const links = (): Promise<unknown[]> =>
  sql.rows(
    `select c.display_name as coach, p.display_name as player
       from coach_links l
       join accounts c on c.id = l.coach_id
       join accounts p on p.id = l.player_id
      order by 1, 2`,
  );

/** Group-member pairs by name. */
const memberships = (): Promise<unknown[]> =>
  sql.rows(
    `select g.name as group, p.display_name as player
       from group_members m
       join groups g on g.id = m.group_id
       join accounts p on p.id = m.player_id
      order by 1, 2`,
  );

describe('the access table (plan decision 14)', () => {
  it('covers every coach page', () => {
    const pages = readdirSync(join(APP, 'treneris'), {
      recursive: true,
      encoding: 'utf8',
    })
      .filter((file) => file.endsWith('page.tsx'))
      .map((file) =>
        posix.join('treneris', dirname(file).split(sep).join('/')),
      );
    expect(new Set(pages)).toEqual(new Set(Object.keys(COACH_PAGES)));
  });

  it('covers every server action module that calls requireCoach', () => {
    expect(new Set(coachActionModules())).toEqual(
      new Set(Object.keys(COACH_ACTION_MODULES)),
    );
  });

  it.each(Object.entries(COACH_ACTION_MODULES))(
    'covers every action of %s',
    (_module, { exports, table }) => {
      expect(new Set(Object.keys(exports))).toEqual(
        new Set(Object.keys(table)),
      );
    },
  );
});

describe('a coach who is not linked (checklist 1)', () => {
  it.each(PLAYER_AND_GROUP_PAGES)(
    'gets 404 from the %s loader for another coach’s player or group',
    async (_page, load) => {
      const ids = await setUp();
      actAs(ids.dovydas);
      expect(await outcomeOf(load(ids))).toEqual({ notFound: true });
    },
  );

  it.each(ACTIONS_ON_RIMANTAS)(
    'changes nothing through %s aimed at another coach’s player, group or invite',
    async (_action, act) => {
      const ids = await setUp();
      const before = await coachingRows();
      actAs(ids.dovydas);
      // A form action answers nothing; a stateful one, its refusal.
      expect([
        undefined,
        { refusal: 'coach.groupNotFound' },
        { refusal: 'coach.notLinked' },
        { refusal: 'invite.invalid' },
        { refusal: 'access.notLinked' },
        { refusal: 'assignment.notFound' },
      ]).toContainEqual(await outcomeOf(act(ids)));
      expect(await coachingRows()).toEqual(before);
    },
  );

  it.each(Object.entries(ASSIGN_ACTIONS))(
    '%s on another coach’s repertoire or assignment is assignment.notFound; for its coach it saves',
    async (_action, act) => {
      const ids = await setUp();
      const before = await coachingRows();
      actAs(ids.dovydas);
      expect(await outcomeOf(act(ids))).toEqual({
        refusal: 'assignment.notFound',
      });
      expect(await coachingRows()).toEqual(before);
      actAs(ids.rimantas);
      expect(await outcomeOf(act(ids))).toEqual({ saved: 1 });
    },
  );

  it('cannot put another coach’s player into the own group', async () => {
    const ids = await setUp();
    const before = await coachingRows();
    actAs(ids.dovydas);
    await outcomeOf(
      addMemberAction(
        {},
        formOf({ groupId: ids.dovydasGroup, playerId: ids.rokas.id }),
      ),
    );
    expect(await coachingRows()).toEqual(before);
  });

  it('sees only the own players, groups and invites at home', async () => {
    const ids = await setUp();
    const dovydasInvite = await openInvite(ids.dovydas.id);
    actAs(ids.dovydas);
    const dovydasHome = await outcomeOf(coachHomeData());
    expect(dovydasHome).toMatchObject({
      players: [{ id: ids.gabija.id, displayName: 'Gabija' }],
      groups: [{ id: ids.dovydasGroup, name: 'Dovydo grupė', memberCount: 1 }],
    });
    expect(dovydasHome).toHaveProperty('players.length', 1);
    expect(dovydasHome).toHaveProperty('groups.length', 1);
    const home = JSON.stringify(dovydasHome);
    expect(home).not.toContain(ids.rokas.id);
    expect(home).not.toContain(ids.group);
    expect(home).not.toContain(ids.invite);
    expect(home).toContain(dovydasInvite);

    actAs(ids.rimantas);
    const rimantasHome = await outcomeOf(coachHomeData());
    expect(rimantasHome).toMatchObject({
      players: [{ id: ids.rokas.id, displayName: 'Rokas Petrauskas' }],
      groups: [{ id: ids.group, name: 'Šeštadienio grupė', memberCount: 1 }],
    });
    expect(rimantasHome).toHaveProperty('players.length', 1);
    expect(rimantasHome).toHaveProperty('groups.length', 1);
    expect(JSON.stringify(rimantasHome)).not.toContain(ids.gabija.id);
    expect(JSON.stringify(rimantasHome)).not.toContain(dovydasInvite);
  });
});

describe('access ends with the link (checklist 3)', () => {
  it('after the player unlinks, the next request is 404', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    expect(await outcomeOf(coachPlayerData(ids.rokas.id))).toMatchObject({
      displayName: 'Rokas Petrauskas',
    });
    actAs(ids.rokas);
    await outcomeOf(unlinkCoachAction(formOf({ coachId: ids.rimantas.id })));
    actAs(ids.rimantas);
    expect(await outcomeOf(coachPlayerData(ids.rokas.id))).toEqual({
      notFound: true,
    });
    expect(await outcomeOf(coachGroupData(ids.group))).toMatchObject({
      members: [],
      addable: [],
    });
    expect(await outcomeOf(coachHomeData())).toMatchObject({ players: [] });
  });

  it('after the coach unlinks, the next request is 404', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    expect(await outcomeOf(coachPlayerData(ids.rokas.id))).toMatchObject({
      displayName: 'Rokas Petrauskas',
    });
    expect(
      await outcomeOf(
        unlinkPlayerAction({}, formOf({ playerId: ids.rokas.id })),
      ),
    ).toEqual({ redirectedTo: '/treneris' });
    expect(await outcomeOf(coachPlayerData(ids.rokas.id))).toEqual({
      notFound: true,
    });
    expect(await outcomeOf(coachGroupData(ids.group))).toMatchObject({
      members: [],
      addable: [],
    });
    expect(await links()).toEqual([{ coach: 'Dovydas', player: 'Gabija' }]);
  });
});

describe('ids in a form never pick whose data changes (checklist 4)', () => {
  it('unlinking another coach’s player leaves that link', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    expect(
      await outcomeOf(
        unlinkPlayerAction(
          {},
          formOf({ playerId: ids.gabija.id, coachId: ids.dovydas.id }),
        ),
      ),
    ).toEqual({ refusal: 'coach.notLinked' });
    expect(await links()).toEqual([
      { coach: 'Dovydas', player: 'Gabija' },
      { coach: 'Rimantas Vaitkus', player: 'Rokas Petrauskas' },
    ]);
  });

  it('a player not linked to the coach never joins the coach’s group', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    await outcomeOf(
      addMemberAction(
        {},
        formOf({ groupId: ids.group, playerId: ids.gabija.id }),
      ),
    );
    expect(await memberships()).toEqual([
      { group: 'Dovydo grupė', player: 'Gabija' },
      { group: 'Šeštadienio grupė', player: 'Rokas Petrauskas' },
    ]);
  });

  it('nobody leaves another coach’s group', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    await outcomeOf(
      removeMemberAction(
        {},
        formOf({ groupId: ids.dovydasGroup, playerId: ids.gabija.id }),
      ),
    );
    expect(await memberships()).toEqual([
      { group: 'Dovydo grupė', player: 'Gabija' },
      { group: 'Šeštadienio grupė', player: 'Rokas Petrauskas' },
    ]);
  });

  it('a coachId in the form never makes a group or invite for that coach', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    await outcomeOf(
      createGroupAction(
        {},
        formOf({ name: 'Svetima grupė', coachId: ids.dovydas.id }),
      ),
    );
    expect(
      await outcomeOf(
        createInviteAction(
          {},
          formOf({ kind: 'personal', groupId: '', coachId: ids.dovydas.id }),
        ),
      ),
    ).toHaveProperty('link');
    expect(
      await sql.rows(
        `select a.display_name as coach, count(*)::int as n
           from invites i join accounts a on a.id = i.coach_id
          group by 1 order by 1`,
      ),
    ).toEqual([
      // setUp: Dovydas's used invite to Gabija; Rimantas's used one to
      // Rokas and his open one; then the one this form made.
      { coach: 'Dovydas', n: 1 },
      { coach: 'Rimantas Vaitkus', n: 3 },
    ]);
    expect(
      await sql.rows(
        `select a.display_name as coach, g.name
           from groups g join accounts a on a.id = g.coach_id
          where g.name = 'Svetima grupė'`,
      ),
    ).toEqual([{ coach: 'Rimantas Vaitkus', name: 'Svetima grupė' }]);
  });
});

/** Every coach page loader and action, as name and call. */
const EVERY_ENTRY = [
  ...Object.entries(COACH_PAGES),
  ...Object.entries(ALL_COACH_ACTIONS),
];

describe('without Coach mode', () => {
  it.each(EVERY_ENTRY)(
    '%s sends the account to settings and changes nothing',
    async (_entry, run) => {
      const ids = await setUp();
      const before = await coachingRows();
      actAs(ids.rokas);
      expect(await outcomeOf(run(ids))).toEqual({
        redirectedTo: '/nustatymai',
      });
      expect(await coachingRows()).toEqual(before);
    },
  );
});

describe('signed out', () => {
  it.each(EVERY_ENTRY)(
    '%s sends the visitor to sign-in and changes nothing',
    async (_entry, run) => {
      const ids = await setUp();
      const before = await coachingRows();
      request.cookie = '';
      expect(await outcomeOf(run(ids))).toEqual({
        redirectedTo: '/prisijungti',
      });
      expect(await coachingRows()).toEqual(before);
    },
  );
});

describe('a shared repertoire (checklist 2-3)', () => {
  /** The coach notes as coach name and text. */
  const notes = (): Promise<unknown[]> =>
    sql.rows(
      `select a.display_name as coach, n.text
         from coach_notes n join accounts a on a.id = n.coach_id
        order by 1, 2`,
    );

  it('is 404 for a linked coach when it is not shared with them', async () => {
    const ids = await setUp();
    const before = await coachingRows();
    actAs(ids.rimantas);
    expect(
      await outcomeOf(sharedRepertoireData(ids.rokas.id, ids.unshared)),
    ).toEqual({ notFound: true });
    expect(
      await outcomeOf(
        saveCoachNoteAction({
          playerId: ids.rokas.id,
          repertoireId: ids.unshared,
          moveKey: D4,
          text: 'Pastaba',
        }),
      ),
    ).toEqual({ refusal: 'access.notShared' });
    expect(await coachingRows()).toEqual(before);
  });

  it('shows the move comments but never the player’s personal notes (R-21, R-102)', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    const data = JSON.stringify(
      await outcomeOf(sharedRepertoireData(ids.rokas.id, ids.london)),
    );
    expect(data).toContain('Solid');
    expect(data).not.toContain(PERSONAL_NOTE);
  });

  it('is 404 on the next request after the player unshares, and the notes go (R-124)', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    expect(
      await outcomeOf(
        saveCoachNoteAction({
          playerId: ids.rokas.id,
          repertoireId: ids.london,
          moveKey: D4,
          text: 'Pastaba',
        }),
      ),
    ).toEqual({});
    expect(await notes()).toEqual([
      { coach: 'Rimantas Vaitkus', text: 'Pastaba' },
    ]);
    actAs(ids.rokas);
    expect(
      await outcomeOf(
        setSharesAction({}, formOf({ repertoireId: ids.london })),
      ),
    ).toEqual({ shared: 0 });
    actAs(ids.rimantas);
    expect(
      await outcomeOf(sharedRepertoireData(ids.rokas.id, ids.london)),
    ).toEqual({ notFound: true });
    expect(await outcomeOf(coachPlayerData(ids.rokas.id))).toMatchObject({
      repertoires: [],
    });
    expect(await notes()).toEqual([]);
  });

  it('is 404 on the next request after the player unlinks, and the notes go (R-124)', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    expect(
      await outcomeOf(sharedRepertoireData(ids.rokas.id, ids.london)),
    ).toMatchObject({ repertoire: { name: 'Londono sistema' } });
    expect(
      await outcomeOf(
        saveCoachNoteAction({
          playerId: ids.rokas.id,
          repertoireId: ids.london,
          moveKey: D4,
          text: 'Pastaba',
        }),
      ),
    ).toEqual({});
    actAs(ids.rokas);
    expect((await repertoirePageData(ids.london)).coachNotes).toHaveLength(1);
    await outcomeOf(unlinkCoachAction(formOf({ coachId: ids.rimantas.id })));
    expect((await repertoirePageData(ids.london)).coachNotes).toEqual([]);
    actAs(ids.rimantas);
    expect(
      await outcomeOf(sharedRepertoireData(ids.rokas.id, ids.london)),
    ).toEqual({ notFound: true });
    expect(await sql.rows('select * from repertoire_shares')).toEqual([]);
  });
});

describe('the progress page (R-152, R-155)', () => {
  it('shows a shared repertoire and a live assignment to their coach', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    expect(
      await outcomeOf(coachProgressData(ids.rokas.id, ids.london)),
    ).toMatchObject({ repertoire: { name: 'Londono sistema' } });
    expect(
      await outcomeOf(coachProgressData(ids.rokas.id, ids.assigned)),
    ).toMatchObject({ repertoire: { name: 'Rimanto Londonas' } });
  });

  it('is 404 for a repertoire not shared with the coach', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    expect(
      await outcomeOf(coachProgressData(ids.rokas.id, ids.unshared)),
    ).toEqual({ notFound: true });
  });

  it('is 404 for a player not linked to the coach', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    expect(
      await outcomeOf(coachProgressData(ids.gabija.id, ids.london)),
    ).toEqual({ notFound: true });
  });

  it('is 404 for an assignment the player forked', async () => {
    const ids = await setUp();
    actAs(ids.rokas);
    expect(
      await outcomeOf(forkAction({}, formOf({ repertoireId: ids.assigned }))),
    ).toHaveProperty('redirectedTo');
    actAs(ids.rimantas);
    expect(
      await outcomeOf(coachProgressData(ids.rokas.id, ids.assigned)),
    ).toEqual({ notFound: true });
  });

  it('is 404 for a malformed player or repertoire id', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    expect(await outcomeOf(coachProgressData('not-an-id', ids.london))).toEqual(
      { notFound: true },
    );
    expect(
      await outcomeOf(coachProgressData(ids.rokas.id, 'not-a-uuid')),
    ).toEqual({ notFound: true });
  });
});
