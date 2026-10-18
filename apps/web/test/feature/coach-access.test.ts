// The coach access suite (S4 Task A15, security checklist 1-4 on #233).
// Every coach page loader and every coach action is driven as a coach who
// is not linked, as an account without Coach mode, and signed out; and the
// access ends on the next request after an unlink from either side.
import { createInvite } from '@mychess/db';
import { readdirSync } from 'node:fs';
import { dirname, join, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unlinkCoachAction } from '../../src/app/nustatymai/coaching-actions';
import * as coachActions from '../../src/app/treneris/actions';
import {
  addMemberAction,
  createGroupAction,
  createInviteAction,
  deleteGroupAction,
  removeMemberAction,
  renameGroupAction,
  revokeInviteAction,
  unlinkPlayerAction,
} from '../../src/app/treneris/actions';
import {
  coachGroupData,
  coachHomeData,
  coachPlayerData,
} from '../../src/server/coach-pages';
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
  return { rimantas, rokas, dovydas, gabija, group, dovydasGroup, invite };
}

// Every page under src/app/treneris has one entry; the guard below fails
// when a page is added without one (plan decision 14).
const COACH_PAGES: Readonly<Record<string, (ids: Ids) => Promise<unknown>>> = {
  treneris: () => coachHomeData(),
  'treneris/zaidejai/[playerId]': (ids) => coachPlayerData(ids.rokas.id),
  'treneris/grupes/[groupId]': (ids) => coachGroupData(ids.group),
  // Part B adds 'treneris/zaidejai/[playerId]/repertuarai/[repertoireId]'.
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
    addMemberAction(formOf({ groupId: ids.group, playerId: ids.gabija.id })),
  removeMemberAction: (ids) =>
    removeMemberAction(formOf({ groupId: ids.group, playerId: ids.rokas.id })),
  unlinkPlayerAction: (ids) =>
    unlinkPlayerAction(formOf({ playerId: ids.rokas.id })),
  createInviteAction: (ids) =>
    createInviteAction({}, formOf({ kind: 'group', groupId: ids.group })),
  revokeInviteAction: (ids) =>
    revokeInviteAction(formOf({ inviteId: ids.invite })),
};

/** The actions that name something of Rimantas's (all but a new group). */
const ACTIONS_ON_RIMANTAS = Object.entries(COACH_ACTIONS).filter(
  ([action]) => action !== 'createGroupAction',
);

/** Every row of the coaching tables, to compare before and after. */
async function coachingRows(): Promise<unknown> {
  return {
    links: await sql.rows('select * from coach_links order by 1, 2'),
    members: await sql.rows('select * from group_members order by 1, 2'),
    groups: await sql.rows('select * from groups order by 1'),
    invites: await sql.rows('select * from invites order by 1'),
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

  it('covers every coach action', () => {
    expect(new Set(Object.keys(coachActions))).toEqual(
      new Set(Object.keys(COACH_ACTIONS)),
    );
  });
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
      // A form action answers nothing; a stateful one, "group not found".
      expect([undefined, { refusal: 'coach.groupNotFound' }]).toContainEqual(
        await outcomeOf(act(ids)),
      );
      expect(await coachingRows()).toEqual(before);
    },
  );

  it('cannot put another coach’s player into the own group', async () => {
    const ids = await setUp();
    const before = await coachingRows();
    actAs(ids.dovydas);
    await outcomeOf(
      addMemberAction(
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
      await outcomeOf(unlinkPlayerAction(formOf({ playerId: ids.rokas.id }))),
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
          formOf({ playerId: ids.gabija.id, coachId: ids.dovydas.id }),
        ),
      ),
    ).toBeUndefined();
    expect(await links()).toEqual([
      { coach: 'Dovydas', player: 'Gabija' },
      { coach: 'Rimantas Vaitkus', player: 'Rokas Petrauskas' },
    ]);
  });

  it('a player not linked to the coach never joins the coach’s group', async () => {
    const ids = await setUp();
    actAs(ids.rimantas);
    await outcomeOf(
      addMemberAction(formOf({ groupId: ids.group, playerId: ids.gabija.id })),
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
  ...Object.entries(COACH_ACTIONS),
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
