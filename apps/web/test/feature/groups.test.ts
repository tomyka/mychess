import { createInvite } from '@mychess/db';
import { OPEN_INVITE_LIMIT } from '@mychess/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  addMemberAction,
  createGroupAction,
  deleteGroupAction,
  removeMemberAction,
  renameGroupAction,
  unlinkPlayerAction,
} from '../../src/app/coach/actions';
import {
  coachGroupData,
  coachHomeData,
  coachPlayerData,
} from '../../src/server/coach-pages';
import {
  actAs,
  coachPerson,
  formOf,
  groupOf,
  link,
  person,
} from './support/coaching';
import { TEST_ENV_VARS } from './support/auth';
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

// The invite link is built from BETTER_AUTH_URL, read from the environment.
beforeEach(() => {
  for (const [name, value] of Object.entries(TEST_ENV_VARS))
    vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A group invite's link, as the action answers it once. */
const GROUP_LINK = /^http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43}$/u;

const groupNames = (): Promise<unknown[]> =>
  sql.rows(
    `select a.display_name as coach, g.name
       from groups g join accounts a on a.id = g.coach_id
      order by 1, 2`,
  );

const memberships = (): Promise<unknown[]> =>
  sql.rows(
    `select g.name as group, p.display_name as player
       from group_members m
       join groups g on g.id = m.group_id
       join accounts p on p.id = m.player_id
      order by 1, 2`,
  );

const links = (): Promise<unknown[]> =>
  sql.rows(
    `select c.display_name as coach, p.display_name as player
       from coach_links l
       join accounts c on c.id = l.coach_id
       join accounts p on p.id = l.player_id
      order by 1, 2`,
  );

describe('createGroupAction (R-12, R-70)', () => {
  it('makes the trimmed group and refreshes the page', async () => {
    actAs(await coachPerson(sql, 'jonas@example.lt', 'Jonas'));
    const state = await outcomeOf(
      createGroupAction({}, formOf({ name: '  Šeštadienio grupė ' })),
    );
    expect(await groupNames()).toEqual([
      { coach: 'Jonas', name: 'Šeštadienio grupė' },
    ]);
    // The new group's id keys the form, so it comes back empty; its group
    // invite's link is shown once (R-204).
    const made = z
      .strictObject({ createdId: z.uuid(), link: z.string().regex(GROUP_LINK) })
      .parse(state);
    expect(made.createdId).toBe(
      (await sql.rows('select id from groups'))
        .map((row) => z.object({ id: z.uuid() }).parse(row).id)
        .at(0),
    );
    expect(request.refreshed).toBe(1);
  });

  it('shows the new group’s invite link once, a group invite into that group (R-204)', async () => {
    actAs(await coachPerson(sql, 'jonas@example.lt', 'Jonas'));
    const state = z
      .strictObject({ createdId: z.uuid(), link: z.string().regex(GROUP_LINK) })
      .parse(await outcomeOf(createGroupAction({}, formOf({ name: 'Grupė' }))));
    expect(
      await sql.rows('select kind, group_id as "groupId" from invites'),
    ).toEqual([{ kind: 'group', groupId: state.createdId }]);
  });

  it('makes groups one after another, each with its own link (ux sign-off: the 4th)', async () => {
    actAs(await coachPerson(sql, 'jonas@example.lt', 'Jonas'));
    const made = z.strictObject({
      createdId: z.uuid(),
      link: z.string().regex(GROUP_LINK),
    });
    const links = new Set<string>();
    let previous = {};
    for (const name of ['Pirma', 'Antra', 'Trečia', 'Ketvirta', 'Penkta']) {
      const state = made.parse(
        await outcomeOf(createGroupAction(previous, formOf({ name }))),
      );
      links.add(state.link);
      previous = state;
    }
    expect(links.size).toBe(5);
    expect(await sql.count('groups')).toBe(5);
    expect(await sql.count('invites')).toBe(5);
  });

  it('makes the group but says no link was made at 50 open invites (R-114)', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const now = new Date();
    for (let made = 0; made < OPEN_INVITE_LIMIT; made += 1) {
      const invite = await createInvite(testDb(), {
        coachId: jonas.id,
        kind: 'personal',
        groupId: null,
        now,
      });
      if (!invite.ok) throw new Error(invite.refusal.reason);
    }
    actAs(jonas);
    const state = await outcomeOf(
      createGroupAction({}, formOf({ name: 'Grupė' })),
    );
    expect(
      z.strictObject({ createdId: z.uuid(), noLink: z.string() }).parse(state)
        .noLink,
    ).toBe('coach.inviteLimit');
    expect(await groupNames()).toEqual([{ coach: 'Jonas', name: 'Grupė' }]);
    expect(await sql.count('invites')).toBe(OPEN_INVITE_LIMIT);
  });

  it('refuses a blank name', async () => {
    actAs(await coachPerson(sql, 'jonas@example.lt', 'Jonas'));
    expect(
      await outcomeOf(createGroupAction({}, formOf({ name: '   ' }))),
    ).toEqual({ refusal: 'groupName.blank' });
    expect(await outcomeOf(createGroupAction({}, new FormData()))).toEqual({
      refusal: 'groupName.blank',
    });
    expect(await groupNames()).toEqual([]);
  });

  it('refuses the 11th group', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    for (let n = 1; n <= 10; n += 1)
      await groupOf(jonas.id, `Grupė ${String(n)}`);
    actAs(jonas);
    expect(
      await outcomeOf(createGroupAction({}, formOf({ name: 'Grupė 11' }))),
    ).toEqual({ refusal: 'coach.groupLimit' });
    expect(await sql.count('groups')).toBe(10);
  });

  it('sends an account without Coach mode to settings, where the switch is', async () => {
    actAs(await person(sql, 'rokas@example.lt', 'Rokas'));
    expect(
      await outcomeOf(createGroupAction({}, formOf({ name: 'Grupė' }))),
    ).toEqual({ redirectedTo: '/settings' });
    expect(await outcomeOf(coachHomeData())).toEqual({
      redirectedTo: '/settings',
    });
    expect(await groupNames()).toEqual([]);
  });

  it('sends a signed-out visitor to sign-in', async () => {
    expect(
      await outcomeOf(createGroupAction({}, formOf({ name: 'Grupė' }))),
    ).toEqual({ redirectedTo: '/sign-in' });
  });
});

describe('renameGroupAction and deleteGroupAction', () => {
  it('rename and delete the coach’s own group', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    actAs(jonas);
    expect(
      await outcomeOf(
        renameGroupAction({}, formOf({ groupId, name: ' Sekmadienio grupė ' })),
      ),
    ).toEqual({ saved: true });
    expect(await groupNames()).toEqual([
      { coach: 'Jonas', name: 'Sekmadienio grupė' },
    ]);
    expect(await outcomeOf(deleteGroupAction(formOf({ groupId })))).toEqual({
      redirectedTo: '/coach',
    });
    expect(await groupNames()).toEqual([]);
  });

  it('refuse a blank new name', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    actAs(jonas);
    expect(
      await outcomeOf(renameGroupAction({}, formOf({ groupId, name: ' ' }))),
    ).toEqual({ refusal: 'groupName.blank' });
    expect(await groupNames()).toEqual([
      { coach: 'Jonas', name: 'Šeštadienio grupė' },
    ]);
  });

  it('change nothing for another coach’s group', async () => {
    const ona = await coachPerson(sql, 'ona@example.lt', 'Ona');
    const onas = await groupOf(ona.id, 'Onos grupė');
    actAs(await coachPerson(sql, 'jonas@example.lt', 'Jonas'));
    expect(
      await outcomeOf(
        renameGroupAction({}, formOf({ groupId: onas, name: 'Mano' })),
      ),
    ).toEqual({ refusal: 'coach.groupNotFound' });
    expect(
      await outcomeOf(deleteGroupAction(formOf({ groupId: onas }))),
    ).toBeUndefined();
    expect(
      await outcomeOf(deleteGroupAction(formOf({ groupId: 'not-a-uuid' }))),
    ).toBeUndefined();
    expect(await groupNames()).toEqual([{ coach: 'Ona', name: 'Onos grupė' }]);
    expect(await outcomeOf(coachGroupData(onas))).toEqual({ notFound: true });
    expect(await outcomeOf(coachGroupData('not-a-uuid'))).toEqual({
      notFound: true,
    });
  });
});

describe('addMemberAction and removeMemberAction (R-12)', () => {
  it('put a linked player into the coach’s group and take them out again', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    await link(jonas.id, rokas.id);
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    actAs(jonas);
    expect(
      await outcomeOf(
        addMemberAction({}, formOf({ groupId, playerId: rokas.id })),
      ),
    ).toEqual({});
    expect(await memberships()).toEqual([
      { group: 'Šeštadienio grupė', player: 'Rokas' },
    ]);
    expect(await outcomeOf(coachGroupData(groupId))).toMatchObject({
      name: 'Šeštadienio grupė',
      members: [{ id: rokas.id, displayName: 'Rokas' }],
    });
    expect(
      await outcomeOf(
        removeMemberAction({}, formOf({ groupId, playerId: rokas.id })),
      ),
    ).toEqual({});
    expect(await memberships()).toEqual([]);
    expect(await links()).toEqual([{ coach: 'Jonas', player: 'Rokas' }]);
  });

  it('never add a player who is not linked, or into another coach’s group', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const ona = await coachPerson(sql, 'ona@example.lt', 'Ona');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
    await link(jonas.id, rokas.id);
    await link(ona.id, gabija.id);
    const mine = await groupOf(jonas.id, 'Jono grupė');
    const onas = await groupOf(ona.id, 'Onos grupė');
    actAs(jonas);
    expect(
      await outcomeOf(
        addMemberAction({}, formOf({ groupId: mine, playerId: gabija.id })),
      ),
    ).toEqual({ refusal: 'coach.notLinked' });
    expect(
      await outcomeOf(
        addMemberAction({}, formOf({ groupId: onas, playerId: rokas.id })),
      ),
    ).toEqual({ refusal: 'coach.groupNotFound' });
    expect(
      await outcomeOf(
        addMemberAction({}, formOf({ groupId: 'x', playerId: rokas.id })),
      ),
    ).toEqual({ refusal: 'coach.groupNotFound' });
    expect(
      await outcomeOf(addMemberAction({}, formOf({ groupId: mine }))),
    ).toEqual({ refusal: 'coach.notLinked' });
    expect(await memberships()).toEqual([]);
  });

  it('read a malformed group before a malformed player, and add no one', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    await link(jonas.id, rokas.id);
    await groupOf(jonas.id, 'Jono grupė');
    actAs(jonas);
    expect(
      await outcomeOf(
        addMemberAction({}, formOf({ groupId: 'x', playerId: '' })),
      ),
    ).toEqual({ refusal: 'coach.groupNotFound' });
    expect(await memberships()).toEqual([]);
  });

  it('never take a player out of another coach’s group', async () => {
    const ona = await coachPerson(sql, 'ona@example.lt', 'Ona');
    const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
    const onas = await groupOf(ona.id, 'Onos grupė');
    await link(ona.id, gabija.id, onas);
    actAs(await coachPerson(sql, 'jonas@example.lt', 'Jonas'));
    expect(
      await outcomeOf(
        removeMemberAction({}, formOf({ groupId: onas, playerId: gabija.id })),
      ),
    ).toEqual({ refusal: 'coach.groupNotFound' });
    expect(await memberships()).toEqual([
      { group: 'Onos grupė', player: 'Gabija' },
    ]);
  });
});

describe('unlinkPlayerAction (spec: either side may unlink)', () => {
  it('ends the coach’s own link and the player’s memberships with it', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    await link(jonas.id, rokas.id, groupId);
    actAs(jonas);
    // Back to the dashboard: the player's page would now be 404.
    expect(
      await outcomeOf(unlinkPlayerAction({}, formOf({ playerId: rokas.id }))),
    ).toEqual({ redirectedTo: '/coach' });
    expect(await links()).toEqual([]);
    expect(await memberships()).toEqual([]);
  });

  it('never ends another coach’s link (checklist 4)', async () => {
    const ona = await coachPerson(sql, 'ona@example.lt', 'Ona');
    const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
    await link(ona.id, gabija.id);
    actAs(await coachPerson(sql, 'jonas@example.lt', 'Jonas'));
    expect(
      await outcomeOf(
        unlinkPlayerAction(
          {},
          formOf({ playerId: gabija.id, coachId: ona.id }),
        ),
      ),
    ).toEqual({ refusal: 'coach.notLinked' });
    expect(await outcomeOf(unlinkPlayerAction({}, new FormData()))).toEqual({
      refusal: 'coach.notLinked',
    });
    expect(await links()).toEqual([{ coach: 'Ona', player: 'Gabija' }]);
    expect(request.refreshed).toBe(2);
  });
});

describe('coachGroupData (the group page)', () => {
  it('lists the members and, to add, the coach’s other linked players only', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const ona = await coachPerson(sql, 'ona@example.lt', 'Ona');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
    const ruta = await person(sql, 'ruta@example.lt', 'Rūta');
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    await link(jonas.id, rokas.id, groupId);
    await link(jonas.id, gabija.id);
    await link(ona.id, ruta.id);
    actAs(jonas);
    const group = await outcomeOf(coachGroupData(groupId));
    expect(group).toMatchObject({
      id: groupId,
      name: 'Šeštadienio grupė',
      members: [{ id: rokas.id, displayName: 'Rokas' }],
    });
    expect(z.object({ addable: z.unknown() }).parse(group).addable).toEqual([
      { id: gabija.id, displayName: 'Gabija' },
    ]);
  });

  it('sends an account without Coach mode to settings (R-113)', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    await sql.rows('update accounts set coach_since = null where id = $1', [
      jonas.id,
    ]);
    actAs(jonas);
    expect(await outcomeOf(coachGroupData(groupId))).toEqual({
      redirectedTo: '/settings',
    });
  });
});

describe('coachPlayerData (the player page)', () => {
  it('shows the display name and the coach’s own groups only, never the email', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const ona = await coachPerson(sql, 'ona@example.lt', 'Ona');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const mine = await groupOf(jonas.id, 'Šeštadienio grupė');
    const onas = await groupOf(ona.id, 'Onos grupė');
    await link(jonas.id, rokas.id, mine);
    await link(ona.id, rokas.id, onas);
    actAs(jonas);
    const data = await outcomeOf(coachPlayerData(rokas.id));
    expect(data).toMatchObject({
      id: rokas.id,
      displayName: 'Rokas',
      groups: [{ id: mine, name: 'Šeštadienio grupė' }],
      repertoires: [],
    });
    expect(
      Object.keys(z.record(z.string(), z.unknown()).parse(data)).sort(),
    ).toEqual([
      'displayName',
      'groups',
      'id',
      'linkedAt',
      'progress',
      'repertoires',
    ]);
    expect(JSON.stringify(data)).not.toContain('rokas@example.lt');
  });

  it('is not found for a player not linked to the coach, or a malformed id (checklist 1)', async () => {
    const ona = await coachPerson(sql, 'ona@example.lt', 'Ona');
    const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
    await link(ona.id, gabija.id);
    actAs(await coachPerson(sql, 'jonas@example.lt', 'Jonas'));
    expect(await outcomeOf(coachPlayerData(gabija.id))).toEqual({
      notFound: true,
    });
    expect(await outcomeOf(coachPlayerData(''))).toEqual({ notFound: true });
  });
});

describe('coachHomeData', () => {
  it('lists the coach’s own players, groups and invites only', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const ona = await coachPerson(sql, 'ona@example.lt', 'Ona');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    await groupOf(ona.id, 'Onos grupė');
    await link(jonas.id, rokas.id, groupId);
    await link(ona.id, gabija.id);
    actAs(jonas);
    expect(await outcomeOf(coachHomeData())).toMatchObject({
      players: [
        {
          id: rokas.id,
          displayName: 'Rokas',
          groups: [{ id: groupId, name: 'Šeštadienio grupė' }],
        },
      ],
      groups: [{ id: groupId, name: 'Šeštadienio grupė', memberCount: 1 }],
      // Open invites only: the personal one Rokas used is gone; the group's
      // own invite, made with it, is open (R-204).
      invites: [{ kind: 'group', groupName: 'Šeštadienio grupė' }],
    });
  });
});
