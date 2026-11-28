import { assign } from '@mychess/db';
import type { AssignmentTarget } from '@mychess/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  leaveGroupAction,
  unlinkCoachAction,
} from '../../src/app/settings/coaching-actions';
import { coachPlayerData } from '../../src/server/coach-pages';
import { myCoachesData } from '../../src/server/settings-page';
import {
  actAs,
  coachPerson,
  formOf,
  groupOf,
  link,
  person,
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

const links = (): Promise<unknown[]> =>
  sql.rows(
    `select c.display_name as coach, p.display_name as player
       from coach_links l
       join accounts c on c.id = l.coach_id
       join accounts p on p.id = l.player_id
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

describe('unlinkCoachAction (spec: either side may unlink)', () => {
  it('ends the link, and the coach sees nothing of the player on the next request (checklist 3)', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    await link(jonas.id, rokas.id);
    actAs(jonas);
    expect(await outcomeOf(coachPlayerData(rokas.id))).toMatchObject({
      displayName: 'Rokas',
    });
    actAs(rokas);
    expect(
      await outcomeOf(unlinkCoachAction(formOf({ coachId: jonas.id }))),
    ).toBeUndefined();
    expect(await links()).toEqual([]);
    expect(request.refreshed).toBe(1);
    actAs(jonas);
    expect(await outcomeOf(coachPlayerData(rokas.id))).toEqual({
      notFound: true,
    });
  });

  it('changes nothing for a coach the player is not linked to (checklist 4)', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const ona = await coachPerson(sql, 'ona@example.lt', 'Ona');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
    await link(jonas.id, rokas.id);
    await link(ona.id, gabija.id);
    actAs(rokas);
    await outcomeOf(unlinkCoachAction(formOf({ coachId: ona.id })));
    expect(await links()).toEqual([
      { coach: 'Jonas', player: 'Rokas' },
      { coach: 'Ona', player: 'Gabija' },
    ]);
  });

  it('unlinks the session account, never the playerId a form carries (checklist 4)', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
    await link(jonas.id, rokas.id);
    await link(jonas.id, gabija.id);
    actAs(rokas);
    await outcomeOf(
      unlinkCoachAction(formOf({ coachId: jonas.id, playerId: gabija.id })),
    );
    expect(await links()).toEqual([{ coach: 'Jonas', player: 'Gabija' }]);
  });

  it('sends a signed-out visitor to sign-in', async () => {
    expect(
      await outcomeOf(unlinkCoachAction(formOf({ coachId: 'x' }))),
    ).toEqual({ redirectedTo: '/sign-in' });
  });
});

describe('leaveGroupAction (R-45)', () => {
  it('takes the player out of the group and keeps the link', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    await link(jonas.id, rokas.id, groupId);
    actAs(rokas);
    expect(
      await outcomeOf(leaveGroupAction(formOf({ groupId }))),
    ).toBeUndefined();
    expect(await memberships()).toEqual([]);
    expect(await links()).toEqual([{ coach: 'Jonas', player: 'Rokas' }]);
    expect(request.refreshed).toBe(1);
  });

  it('changes nothing for a group the player is not in, or a malformed id', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
    const saturday = await groupOf(jonas.id, 'Šeštadienio grupė');
    const sunday = await groupOf(jonas.id, 'Sekmadienio grupė');
    await link(jonas.id, rokas.id, saturday);
    await link(jonas.id, gabija.id, sunday);
    actAs(rokas);
    await outcomeOf(leaveGroupAction(formOf({ groupId: sunday })));
    await outcomeOf(leaveGroupAction(formOf({ groupId: 'not-a-uuid' })));
    expect(await memberships()).toEqual([
      { group: 'Sekmadienio grupė', player: 'Gabija' },
      { group: 'Šeštadienio grupė', player: 'Rokas' },
    ]);
  });

  it('takes the session account out, never the playerId a form carries (checklist 4)', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    await link(jonas.id, rokas.id, groupId);
    await link(jonas.id, gabija.id, groupId);
    actAs(rokas);
    await outcomeOf(leaveGroupAction(formOf({ groupId, playerId: gabija.id })));
    expect(await memberships()).toEqual([
      { group: 'Šeštadienio grupė', player: 'Gabija' },
    ]);
  });
});

/** Assigns `repertoireId` of `coachId` to `target`, with no deadline. */
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

/** Each coach of the player's My coaches: name, groups and assigned names. */
async function myCoachesOf(playerId: string): Promise<unknown> {
  const { coaches } = await myCoachesData(playerId, new Date());
  return coaches.map(({ displayName, groups, assignments }) => ({
    coach: displayName,
    groups: groups.map(({ name }) => name),
    assigned: assignments.map(({ name }) => name),
  }));
}

describe('My coaches in Settings (R-237)', () => {
  it("lists each of the player's coaches with what that coach assigns them, directly or through a group, and nothing of another player's", async () => {
    const rimantas = await coachPerson(sql, 'rimantas@example.lt', 'Rimantas');
    const ona = await coachPerson(sql, 'ona@example.lt', 'Ona');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
    const group = await groupOf(rimantas.id, 'Šeštadienio grupė');
    await link(rimantas.id, rokas.id, group);
    await link(rimantas.id, gabija.id);
    await link(ona.id, gabija.id);
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
    const onas = await seedRepertoire(testDb(), 'ona@example.lt', {
      pgn: LONDON,
      side: 'white',
      name: 'Onos Londonas',
    });
    await assignTo(rimantas.id, london, { kind: 'player', playerId: rokas.id });
    await assignTo(rimantas.id, taimanov, { kind: 'group', groupId: group });
    await assignTo(ona.id, onas, { kind: 'player', playerId: gabija.id });

    expect(await myCoachesOf(rokas.id)).toEqual([
      {
        coach: 'Rimantas',
        groups: ['Šeštadienio grupė'],
        assigned: ['Londono sistema', 'Taimanovas'],
      },
    ]);
    expect(await myCoachesOf(gabija.id)).toEqual([
      { coach: 'Ona', groups: [], assigned: ['Onos Londonas'] },
      { coach: 'Rimantas', groups: [], assigned: [] },
    ]);
  });
});
