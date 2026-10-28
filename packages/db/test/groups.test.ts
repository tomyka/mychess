import { COACH_REFUSALS } from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import {
  addMember,
  coachGroup,
  coachGroups,
  createGroup,
  deleteGroup,
  leaveGroup,
  removeMember,
  renameGroup,
} from '../src';
import { useTestDatabase } from '../src/testing';
import {
  offersOf,
  seedAssignment,
  seedRepertoire,
} from './support/assignments';
import {
  LITHUANIAN_ORDER,
  openTransaction,
  seedCoach,
  seedGroup,
  seedLink,
  seedMember,
  seedNamedAccounts,
  seedPlayer,
  someoneWaitsForALock,
  T0,
  UNSORTED_NAMES,
} from './support/coaching';

const { db, client } = useTestDatabase();

const NOW = new Date('2026-10-16T09:00:00Z');
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

const query = async (
  text: string,
  params: unknown[] = [],
): Promise<unknown[]> =>
  (await client.query<Record<string, unknown>>(text, params)).rows;

const refused = (reason: string) => ({ ok: false, refusal: { reason } });
const OK = { ok: true, value: undefined };
const NOT_FOUND = refused(COACH_REFUSALS.groupNotFound);

async function seedGroups(coachId: string, count: number): Promise<void> {
  for (let i = 1; i <= count; i += 1)
    await seedGroup(db, coachId, `G${String(i)}`);
}

const members = () =>
  query(
    'select group_id, coach_id, player_id, joined_at from group_members order by group_id, player_id',
  );

describe('createGroup', () => {
  it('makes a group of the coach and returns its id (R-12)', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    const made = await createGroup(db, 'c', 'Šeštadienio grupė', NOW);
    if (!made.ok) throw new Error(made.refusal.reason);
    expect(
      await query('select id, coach_id, name, created_at from groups'),
    ).toEqual([
      {
        id: made.value,
        coach_id: 'c',
        name: 'Šeštadienio grupė',
        created_at: NOW,
      },
    ]);
  });

  it('refuses the 11th group (R-70)', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedGroups('c', 9);
    expect((await createGroup(db, 'c', 'G10', NOW)).ok).toBe(true);
    expect(await createGroup(db, 'c', 'G11', NOW)).toEqual(
      refused(COACH_REFUSALS.groupLimit),
    );
    expect(await query('select count(*)::int as n from groups')).toEqual([
      { n: 10 },
    ]);
  });

  it("does not count another coach's groups", async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedCoach(db, 'd', 'd@example.lt');
    await seedGroups('d', 10);
    expect((await createGroup(db, 'c', 'Mano', NOW)).ok).toBe(true);
  });

  it.each([
    ['without Coach mode', 'p'],
    ['unknown', 'nobody'],
  ])('refuses an account %s', async (_, id) => {
    await seedPlayer(db, 'p', 'p@example.lt');
    expect(await createGroup(db, id, 'Mano', NOW)).toEqual(
      refused(COACH_REFUSALS.notCoach),
    );
    expect(await query('select id from groups')).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5])(
    'ends with exactly 10 groups when two creations race at 9, run %i',
    async (run) => {
      const coach = `c${String(run)}`;
      await seedCoach(db, coach, `${coach}@example.lt`);
      await seedGroups(coach, 9);
      const results = await Promise.all([
        createGroup(db, coach, 'A', NOW),
        createGroup(db, coach, 'B', NOW),
      ]);
      expect(results.filter((r) => !r.ok)).toEqual([
        refused(COACH_REFUSALS.groupLimit),
      ]);
      expect(
        await query(
          'select count(*)::int as n from groups where coach_id = $1',
          [coach],
        ),
      ).toEqual([{ n: 10 }]);
    },
  );
});

describe('renameGroup and deleteGroup', () => {
  it("renames only the coach's own group", async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedCoach(db, 'd', 'd@example.lt');
    const own = await seedGroup(db, 'c', 'Sena');
    const foreign = await seedGroup(db, 'd', 'Kita');
    expect(await renameGroup(db, 'c', own, 'Nauja')).toEqual(OK);
    expect(await renameGroup(db, 'c', foreign, 'Pagrobta')).toEqual(NOT_FOUND);
    expect(await renameGroup(db, 'c', UNKNOWN, 'X')).toEqual(NOT_FOUND);
    expect(await renameGroup(db, 'c', 'not-a-uuid', 'X')).toEqual(NOT_FOUND);
    expect(await query('select name from groups order by name')).toEqual([
      { name: 'Kita' },
      { name: 'Nauja' },
    ]);
  });

  it("deletes only the coach's own group, with its members and invites", async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedCoach(db, 'd', 'd@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedLink(db, 'c', 'p');
    const own = await seedGroup(db, 'c', 'Mano');
    const foreign = await seedGroup(db, 'd', 'Kita');
    await seedMember(db, 'c', own, 'p');
    await client.query(
      `insert into invites (coach_id, kind, group_id, token_hash, expires_at, created_at)
       values ('c', 'group', $1, $2, now(), now())`,
      [own, 'a'.repeat(64)],
    );
    expect(await deleteGroup(db, 'c', foreign, NOW)).toEqual(NOT_FOUND);
    expect(await deleteGroup(db, 'c', 'not-a-uuid', NOW)).toEqual(NOT_FOUND);
    expect(await deleteGroup(db, 'c', own, NOW)).toEqual(OK);
    expect(await query('select id from groups')).toEqual([{ id: foreign }]);
    expect(await members()).toEqual([]);
    expect(await query('select id from invites')).toEqual([]);
    expect(await query('select player_id from coach_links')).toEqual([
      { player_id: 'p' },
    ]);
    expect(await deleteGroup(db, 'c', own, NOW)).toEqual(NOT_FOUND);
  });
});

describe('addMember and removeMember', () => {
  it('adds a linked player once; adding again changes nothing', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedLink(db, 'c', 'p');
    const groupId = await seedGroup(db, 'c', 'Mano');
    expect(
      await addMember(
        db,
        { coachId: 'c', groupId: groupId, playerId: 'p' },
        NOW,
      ),
    ).toEqual(OK);
    expect(
      await addMember(
        db,
        { coachId: 'c', groupId: groupId, playerId: 'p' },
        new Date('2026-10-17T09:00:00Z'),
      ),
    ).toEqual(OK);
    expect(await members()).toEqual([
      { group_id: groupId, coach_id: 'c', player_id: 'p', joined_at: NOW },
    ]);
  });

  it('refuses a player who is not linked to the coach', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedCoach(db, 'd', 'd@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedLink(db, 'd', 'p');
    const groupId = await seedGroup(db, 'c', 'Mano');
    expect(
      await addMember(
        db,
        { coachId: 'c', groupId: groupId, playerId: 'p' },
        NOW,
      ),
    ).toEqual(refused(COACH_REFUSALS.notLinked));
    expect(await members()).toEqual([]);
  });

  it.each([
    ["another coach's group", 'foreign'],
    ['an unknown group', UNKNOWN],
    ['a malformed group id', 'not-a-uuid'],
  ])('refuses %s', async (_, which) => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedCoach(db, 'd', 'd@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedLink(db, 'c', 'p');
    await seedLink(db, 'd', 'p');
    const foreign = await seedGroup(db, 'd', 'Kita');
    const groupId = which === 'foreign' ? foreign : which;
    expect(
      await addMember(
        db,
        { coachId: 'c', groupId: groupId, playerId: 'p' },
        NOW,
      ),
    ).toEqual(refused(COACH_REFUSALS.groupNotFound));
    expect(await members()).toEqual([]);
  });

  it('refuses a group deleted while it waited for the group row', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedLink(db, 'c', 'p');
    const groupId = await seedGroup(db, 'c', 'Mano');
    const deleting = await openTransaction(client, [
      `delete from groups where id = '${groupId}'`,
    ]);
    const adding = addMember(db, { coachId: 'c', groupId, playerId: 'p' }, NOW);
    await someoneWaitsForALock(client);
    await deleting.finish();
    expect(await adding).toEqual(NOT_FOUND);
    expect(await members()).toEqual([]);
  });

  it("removes a member from the coach's own group only", async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedCoach(db, 'd', 'd@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedLink(db, 'c', 'p');
    await seedLink(db, 'd', 'p');
    const own = await seedGroup(db, 'c', 'Mano');
    const foreign = await seedGroup(db, 'd', 'Kita');
    await seedMember(db, 'c', own, 'p');
    await seedMember(db, 'd', foreign, 'p');
    expect(
      await removeMember(
        db,
        { coachId: 'c', groupId: foreign, playerId: 'p' },
        NOW,
      ),
    ).toEqual(NOT_FOUND);
    expect(
      await removeMember(
        db,
        { coachId: 'c', groupId: 'not-a-uuid', playerId: 'p' },
        NOW,
      ),
    ).toEqual(NOT_FOUND);
    expect(
      await removeMember(
        db,
        { coachId: 'c', groupId: own, playerId: 'p' },
        NOW,
      ),
    ).toEqual(OK);
    // Like adding twice: removing again changes nothing.
    expect(
      await removeMember(
        db,
        { coachId: 'c', groupId: own, playerId: 'p' },
        NOW,
      ),
    ).toEqual(OK);
    expect(await query('select group_id from group_members')).toEqual([
      { group_id: foreign },
    ]);
    expect(await query('select count(*)::int as n from coach_links')).toEqual([
      { n: 2 },
    ]);
  });
});

describe('while Coach mode is off the groups are read-only (R-113)', () => {
  const NOT_COACH = refused(COACH_REFUSALS.notCoach);

  /**
   * Coach c with group "Mano" holding p, and q linked but not in it.
   * Coach mode then goes off underneath (a state stopCoaching reaches with
   * no links; the links here make each refusal the Coach mode one).
   */
  async function seedOffCoach(): Promise<string> {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedPlayer(db, 'q', 'q@example.lt');
    await seedLink(db, 'c', 'p');
    await seedLink(db, 'c', 'q');
    const groupId = await seedGroup(db, 'c', 'Mano');
    await seedMember(db, 'c', groupId, 'p');
    await client.query(`update accounts set coach_since = null where id = 'c'`);
    return groupId;
  }

  const changes = {
    rename: (groupId: string) => renameGroup(db, 'c', groupId, 'Nauja'),
    delete: (groupId: string) => deleteGroup(db, 'c', groupId, NOW),
    add: (groupId: string) =>
      addMember(db, { coachId: 'c', groupId, playerId: 'q' }, NOW),
    remove: (groupId: string) =>
      removeMember(db, { coachId: 'c', groupId, playerId: 'p' }, NOW),
  };

  it.each(Object.entries(changes))('refuses to %s', async (_, change) => {
    const groupId = await seedOffCoach();
    expect(await change(groupId)).toEqual(NOT_COACH);
    expect(await query('select id, name from groups')).toEqual([
      { id: groupId, name: 'Mano' },
    ]);
    expect(await query('select player_id from group_members')).toEqual([
      { player_id: 'p' },
    ]);
  });

  it.each(Object.entries(changes))(
    'refuses to %s once Coach mode went off while it waited for the coach row',
    async (_, change) => {
      await seedCoach(db, 'c', 'c@example.lt');
      await seedPlayer(db, 'p', 'p@example.lt');
      await seedPlayer(db, 'q', 'q@example.lt');
      await seedLink(db, 'c', 'p');
      await seedLink(db, 'c', 'q');
      const groupId = await seedGroup(db, 'c', 'Mano');
      await seedMember(db, 'c', groupId, 'p');
      const stopping = await openTransaction(client, [
        `select id from accounts where id = 'c' for no key update`,
      ]);
      const changing = change(groupId);
      await someoneWaitsForALock(client);
      await stopping.finish(
        `update accounts set coach_since = null where id = 'c'`,
      );
      expect(await changing).toEqual(NOT_COACH);
      expect(await query('select name from groups')).toEqual([
        { name: 'Mano' },
      ]);
      expect(await query('select player_id from group_members')).toEqual([
        { player_id: 'p' },
      ]);
    },
  );

  it('refuses an unknown coach account', async () => {
    const groupId = await seedOffCoach();
    expect(await renameGroup(db, 'nobody', groupId, 'X')).toEqual(NOT_COACH);
    expect(await deleteGroup(db, 'nobody', groupId, NOW)).toEqual(NOT_COACH);
  });

  it('still lets the player leave the group', async () => {
    const groupId = await seedOffCoach();
    expect(await leaveGroup(db, 'p', groupId, NOW)).toEqual(OK);
    expect(await members()).toEqual([]);
  });

  it('allows the changes again once Coach mode is back on', async () => {
    const groupId = await seedOffCoach();
    await client.query(
      `update accounts set coach_since = now() where id = 'c'`,
    );
    expect(await changes.rename(groupId)).toEqual(OK);
    expect(await changes.add(groupId)).toEqual(OK);
    expect(await changes.remove(groupId)).toEqual(OK);
    expect(await query('select name from groups')).toEqual([{ name: 'Nauja' }]);
    expect(await query('select player_id from group_members')).toEqual([
      { player_id: 'q' },
    ]);
    expect(await changes.delete(groupId)).toEqual(OK);
    expect(await query('select id from groups')).toEqual([]);
  });
});

describe('leaveGroup', () => {
  it('removes only that membership and keeps the Coach link (R-45)', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedPlayer(db, 'q', 'q@example.lt');
    await seedLink(db, 'c', 'p');
    await seedLink(db, 'c', 'q');
    const first = await seedGroup(db, 'c', 'Pirma');
    const second = await seedGroup(db, 'c', 'Antra');
    await seedMember(db, 'c', first, 'p');
    await seedMember(db, 'c', second, 'p');
    await seedMember(db, 'c', first, 'q');
    expect(await leaveGroup(db, 'p', first, NOW)).toEqual(OK);
    expect(await leaveGroup(db, 'p', first, NOW)).toEqual(NOT_FOUND);
    expect(await leaveGroup(db, 'p', 'not-a-uuid', NOW)).toEqual(NOT_FOUND);
    expect(
      await query(
        'select group_id, player_id from group_members order by player_id, group_id',
      ),
    ).toEqual([
      { group_id: second, player_id: 'p' },
      { group_id: first, player_id: 'q' },
    ]);
    expect(await query('select player_id from coach_links order by 1')).toEqual(
      [{ player_id: 'p' }, { player_id: 'q' }],
    );
  });
});

describe('coachGroups and coachGroup', () => {
  async function seedTwoGroups() {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedCoach(db, 'd', 'd@example.lt');
    await seedPlayer(db, 'ruta', 'ruta@example.lt');
    await seedPlayer(db, 'jonas', 'jonas@example.lt');
    await client.query(
      `update accounts set display_name = 'Rūta' where id = 'ruta';
       update accounts set display_name = 'Jonas' where id = 'jonas'`,
    );
    await seedLink(db, 'c', 'ruta');
    await seedLink(db, 'c', 'jonas');
    await seedLink(db, 'd', 'ruta');
    const saturday = await seedGroup(db, 'c', 'Šeštadienis');
    const empty = await seedGroup(db, 'c', 'Pradedantieji');
    const foreign = await seedGroup(db, 'd', 'Kita');
    await seedMember(db, 'c', saturday, 'ruta');
    await seedMember(db, 'c', saturday, 'jonas');
    await seedMember(db, 'd', foreign, 'ruta');
    return { saturday, empty, foreign };
  }

  it("lists the coach's groups by name with their member counts", async () => {
    const { saturday, empty } = await seedTwoGroups();
    expect(await coachGroups(db, 'c')).toEqual([
      { id: empty, name: 'Pradedantieji', memberCount: 0, createdAt: T0 },
      { id: saturday, name: 'Šeštadienis', memberCount: 2, createdAt: T0 },
    ]);
    expect(await coachGroups(db, 'ruta')).toEqual([]);
  });

  it('returns one group of the coach with its members by name', async () => {
    const { saturday, foreign } = await seedTwoGroups();
    expect(await coachGroup(db, 'c', saturday)).toEqual({
      id: saturday,
      name: 'Šeštadienis',
      createdAt: T0,
      members: [
        { id: 'jonas', displayName: 'Jonas', joinedAt: T0 },
        { id: 'ruta', displayName: 'Rūta', joinedAt: T0 },
      ],
    });
    expect(await coachGroup(db, 'c', foreign)).toBeUndefined();
    expect(await coachGroup(db, 'c', UNKNOWN)).toBeUndefined();
    expect(await coachGroup(db, 'c', 'not-a-uuid')).toBeUndefined();
  });

  it('lists the groups, and a group its members, by Lithuanian name (R-160)', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    for (const name of UNSORTED_NAMES) await seedGroup(db, 'c', name);
    const group = await seedGroup(db, 'c', 'Šeštadienis');
    const players = await seedNamedAccounts(db, 'p', UNSORTED_NAMES);
    for (const player of players) {
      await seedLink(db, 'c', player);
      await seedMember(db, 'c', group, player);
    }
    expect((await coachGroups(db, 'c')).map(({ name }) => name)).toEqual([
      ...LITHUANIAN_ORDER.slice(0, 3),
      'Šeštadienis',
      ...LITHUANIAN_ORDER.slice(3),
    ]);
    expect(
      (await coachGroup(db, 'c', group))?.members.map(
        (member) => member.displayName,
      ),
    ).toEqual(LITHUANIAN_ORDER);
  });
});

describe("group changes and the group's assignments (R-16, R-45)", () => {
  const LATER = new Date('2026-10-17T09:00:00Z');

  async function seedAssigned(): Promise<{ groupId: string; rep: string }> {
    await seedCoach(db, 'c', 'c@example.lt');
    for (const id of ['p', 'q']) {
      await seedPlayer(db, id, `${id}@example.lt`);
      await seedLink(db, 'c', id);
    }
    const groupId = await seedGroup(db, 'c', 'Mano');
    await seedMember(db, 'c', groupId, 'p');
    await seedMember(db, 'c', groupId, 'q');
    const rep = await seedRepertoire(db, 'c', T0);
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: rep,
      target: { groupId },
      now: T0,
    });
    return { groupId, rep };
  }

  const leftGroup = (playerId: string, rep: string) => ({
    playerId,
    repertoireId: rep,
    reason: 'leftGroup',
    closedAt: null,
  });

  it('offers a fork to a player who leaves the group', async () => {
    const { groupId, rep } = await seedAssigned();
    expect(await leaveGroup(db, 'p', groupId, NOW)).toEqual(OK);
    expect(await offersOf(db)).toEqual([leftGroup('p', rep)]);
  });

  it('offers a fork to a player the coach removes', async () => {
    const { groupId, rep } = await seedAssigned();
    expect(
      await removeMember(db, { coachId: 'c', groupId, playerId: 'q' }, NOW),
    ).toEqual(OK);
    expect(await offersOf(db)).toEqual([leftGroup('q', rep)]);
  });

  it('settles nothing when the player removed is not in the group', async () => {
    const { groupId, rep } = await seedAssigned();
    await seedPlayer(db, 'n', 'n@example.lt');
    await seedLink(db, 'c', 'n');
    // State no assignment reaches: only a real change would tidy it away.
    await query(
      `insert into assignment_players (player_id, repertoire_id, paused_at) values ('n', $1, now())`,
      [rep],
    );
    expect(
      await removeMember(db, { coachId: 'c', groupId, playerId: 'n' }, NOW),
    ).toEqual(OK);
    expect(await query('select player_id from assignment_players')).toEqual([
      { player_id: 'n' },
    ]);
    expect(await offersOf(db)).toEqual([]);
  });

  it('offers a fork to every member when the group is deleted', async () => {
    const { groupId, rep } = await seedAssigned();
    expect(await deleteGroup(db, 'c', groupId, NOW)).toEqual(OK);
    expect(await offersOf(db)).toEqual([
      leftGroup('p', rep),
      leftGroup('q', rep),
    ]);
    expect(await query('select id from assignments')).toEqual([]);
  });

  it('closes the open offer of a player added back (lead decision 4)', async () => {
    const { groupId, rep } = await seedAssigned();
    await leaveGroup(db, 'p', groupId, NOW);
    expect(
      await addMember(db, { coachId: 'c', groupId, playerId: 'p' }, LATER),
    ).toEqual(OK);
    expect(await offersOf(db)).toEqual([
      { ...leftGroup('p', rep), closedAt: LATER },
    ]);
  });

  it('makes a leaving player wait for the coach row, so a group assignment made meanwhile is offered too', async () => {
    const { groupId, rep } = await seedAssigned();
    const second = await seedRepertoire(db, 'c', T0);
    const assigning = await openTransaction(client, [
      `select id from accounts where id = 'c' for no key update`,
      `insert into assignments (coach_id, repertoire_id, group_id, assigned_version, created_at)
       values ('c', '${second}', '${groupId}', 1, now())`,
    ]);
    const leaving = leaveGroup(db, 'p', groupId, NOW);
    await someoneWaitsForALock(client);
    await assigning.finish();
    expect(await leaving).toEqual(OK);
    expect(
      (await offersOf(db)).map((offer) => offer.repertoireId).sort(),
    ).toEqual([rep, second].sort());
  });
});
