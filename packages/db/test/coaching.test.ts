import { COACH_REFUSALS, INVITE_REFUSALS } from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import {
  acceptInvite,
  coachAccessFacts,
  coachPlayer,
  coachPlayers,
  createInvite,
  playerCoaches,
  startCoaching,
  stopCoaching,
  unlink,
} from '../src';
import { inviteTokenHash } from '../src/invite-token';
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
const LATER = new Date('2026-10-16T10:00:00Z');
const WEEK = 7 * 24 * 60 * 60 * 1000;

const query = async (
  text: string,
  params: unknown[] = [],
): Promise<unknown[]> =>
  (await client.query<Record<string, unknown>>(text, params)).rows;

const coachSince = (id: string) =>
  query('select coach_since from accounts where id = $1', [id]);

const refused = (reason: string) => ({ ok: false, refusal: { reason } });

/** A personal invite of `coachId`; returns its raw token. */
async function personalInvite(coachId: string, now = NOW): Promise<string> {
  const made = await createInvite(db, {
    coachId,
    kind: 'personal',
    groupId: null,
    now,
  });
  if (!made.ok) throw new Error(made.refusal.reason);
  return made.value.token;
}

describe('startCoaching', () => {
  it('switches Coach mode on once and keeps the first time (R-11)', async () => {
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedPlayer(db, 'q', 'q@example.lt');
    await startCoaching(db, 'p', NOW);
    await startCoaching(db, 'p', LATER);
    expect(
      await query(
        'select id, coach_since, updated_at from accounts order by id',
      ),
    ).toEqual([
      { id: 'p', coach_since: NOW, updated_at: LATER },
      { id: 'q', coach_since: null, updated_at: T0 },
    ]);
  });
});

describe('stopCoaching', () => {
  it('refuses while a player is linked and keeps Coach mode (R-100)', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedLink(db, 'c', 'p');
    const token = await personalInvite('c');
    expect(await stopCoaching(db, 'c', NOW)).toEqual(
      refused(COACH_REFUSALS.stillLinked),
    );
    expect(await coachSince('c')).toEqual([{ coach_since: T0 }]);
    expect(
      await query('select revoked_at from invites where token_hash = $1', [
        inviteTokenHash(token),
      ]),
    ).toEqual([{ revoked_at: null }]);
  });

  it('switches Coach mode off with nobody linked, keeps the groups and revokes only open invites (R-109)', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedCoach(db, 'c2', 'c2@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    const groupId = await seedGroup(db, 'c', 'Mano');
    const open = await personalInvite('c');
    const expired = await personalInvite('c', new Date(NOW.getTime() - WEEK));
    const used = await personalInvite('c');
    expect((await acceptInvite(db, used, 'p', NOW)).ok).toBe(true);
    await client.query(
      `delete from coach_links where coach_id = 'c' and player_id = 'p'`,
    );
    const others = await personalInvite('c2');
    expect(await stopCoaching(db, 'c', LATER)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      await query(
        'select coach_since, updated_at from accounts where id = $1',
        ['c'],
      ),
    ).toEqual([{ coach_since: null, updated_at: LATER }]);
    expect(await coachSince('c2')).toEqual([{ coach_since: T0 }]);
    const revokedAt = (token: string) =>
      query('select revoked_at from invites where token_hash = $1', [
        inviteTokenHash(token),
      ]);
    expect(await revokedAt(open)).toEqual([{ revoked_at: LATER }]);
    expect(await revokedAt(expired)).toEqual([{ revoked_at: null }]);
    expect(await revokedAt(used)).toEqual([{ revoked_at: null }]);
    expect(await revokedAt(others)).toEqual([{ revoked_at: null }]);
    expect(await query('select id from groups')).toEqual([{ id: groupId }]);
  });

  it('refuses an unknown account', async () => {
    expect(await stopCoaching(db, 'nobody', NOW)).toEqual(
      refused(COACH_REFUSALS.notCoach),
    );
  });

  it('keeps the first revocation time of an invite already revoked', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    const token = await personalInvite('c');
    await client.query('update invites set revoked_at = $1', [NOW]);
    await stopCoaching(db, 'c', LATER);
    expect(
      await query('select revoked_at from invites where token_hash = $1', [
        inviteTokenHash(token),
      ]),
    ).toEqual([{ revoked_at: NOW }]);
  });

  it('revokes an invite made while it waited for the coach row (R-109)', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    // createInvite makes its invite under the coach row's lock.
    const creating = await openTransaction(client, [
      `select id from accounts where id = 'c' for no key update`,
    ]);
    const stopping = stopCoaching(db, 'c', LATER);
    await someoneWaitsForALock(client);
    await creating.finish(
      `insert into invites (coach_id, kind, token_hash, expires_at, created_at)
       values ('c', 'personal', '${'a'.repeat(64)}', '2026-10-23T09:00:00Z', '${NOW.toISOString()}')`,
    );
    expect(await stopping).toEqual({ ok: true, value: undefined });
    expect(await query('select revoked_at from invites')).toEqual([
      { revoked_at: LATER },
    ]);
  });

  // R-109: Coach mode never ends off with an invite still active.
  it.each([1, 2, 3, 4, 5])(
    'never leaves an active invite when it races an invite, run %i',
    async (run) => {
      const coach = `c${String(run)}`;
      await seedCoach(db, coach, `${coach}@example.lt`);
      const [stop, create] = await Promise.all([
        stopCoaching(db, coach, LATER),
        createInvite(db, {
          coachId: coach,
          kind: 'personal',
          groupId: null,
          now: NOW,
        }),
      ]);
      const outcome = {
        stop,
        created: create.ok,
        refusal: create.ok ? undefined : create.refusal,
        invites: await query(
          'select revoked_at from invites where coach_id = $1',
          [coach],
        ),
        coachSince: await coachSince(coach),
      };
      const stoppedFirst = {
        stop: { ok: true, value: undefined },
        created: false,
        refusal: { reason: COACH_REFUSALS.notCoach },
        invites: [],
        coachSince: [{ coach_since: null }],
      };
      const createdFirst = {
        stop: { ok: true, value: undefined },
        created: true,
        refusal: undefined,
        invites: [{ revoked_at: LATER }],
        coachSince: [{ coach_since: null }],
      };
      expect([stoppedFirst, createdFirst]).toContainEqual(outcome);
    },
  );

  // Plan decision 1: switching off and accepting never both succeed.
  it.each([1, 2, 3, 4, 5])(
    'never both stops and accepts when they race, run %i',
    async (run) => {
      const coach = `c${String(run)}`;
      await seedCoach(db, coach, `${coach}@example.lt`);
      await seedPlayer(db, `${coach}-p`, `${coach}-p@example.lt`);
      const token = await personalInvite(coach);
      const [stop, accept] = await Promise.all([
        stopCoaching(db, coach, NOW),
        acceptInvite(db, token, `${coach}-p`, NOW),
      ]);
      const outcome = {
        stop,
        accept,
        links: await query(
          'select player_id from coach_links where coach_id = $1',
          [coach],
        ),
        coachSince: await coachSince(coach),
      };
      const stopped = {
        stop: { ok: true, value: undefined },
        accept: refused(INVITE_REFUSALS.invalid),
        links: [],
        coachSince: [{ coach_since: null }],
      };
      const accepted = {
        stop: refused(COACH_REFUSALS.stillLinked),
        accept: { ok: true, value: { coachId: coach, groupId: null } },
        links: [{ player_id: `${coach}-p` }],
        coachSince: [{ coach_since: T0 }],
      };
      expect([stopped, accepted]).toContainEqual(outcome);
    },
  );
});

/** Coach c with players Rūta (two of c's groups) and Jonas, and coach d. */
async function seedTwoCoaches() {
  await seedCoach(db, 'c', 'c@example.lt');
  await seedCoach(db, 'd', 'd@example.lt');
  await seedPlayer(db, 'ruta', 'ruta@example.lt');
  await seedPlayer(db, 'jonas', 'jonas@example.lt');
  await seedPlayer(db, 'lone', 'lone@example.lt');
  await client.query(
    `update accounts set display_name = 'Rūta' where id = 'ruta';
     update accounts set display_name = 'Jonas' where id = 'jonas';
     update accounts set display_name = 'Coach C' where id = 'c';
     update accounts set display_name = 'Coach D' where id = 'd'`,
  );
  await seedLink(db, 'c', 'ruta');
  await client.query(
    `insert into coach_links (coach_id, player_id, created_at) values ('c', 'jonas', $1)`,
    [NOW],
  );
  await seedLink(db, 'd', 'ruta');
  const saturday = await seedGroup(db, 'c', 'Šeštadienis');
  const advanced = await seedGroup(db, 'c', 'Pažengę');
  const foreign = await seedGroup(db, 'd', 'Kita');
  await seedMember(db, 'c', saturday, 'ruta');
  await seedMember(db, 'c', advanced, 'ruta');
  await seedMember(db, 'd', foreign, 'ruta');
  return { saturday, advanced, foreign };
}

describe('coachPlayers and coachPlayer', () => {
  it("lists the coach's linked players by name with that coach's groups only", async () => {
    const { saturday, advanced } = await seedTwoCoaches();
    expect(await coachPlayers(db, 'c')).toEqual([
      { id: 'jonas', displayName: 'Jonas', linkedAt: NOW, groups: [] },
      {
        id: 'ruta',
        displayName: 'Rūta',
        linkedAt: T0,
        groups: [
          { id: advanced, name: 'Pažengę' },
          { id: saturday, name: 'Šeštadienis' },
        ],
      },
    ]);
  });

  it('lists nothing for a coach without players', async () => {
    await seedTwoCoaches();
    expect(await coachPlayers(db, 'lone')).toEqual([]);
  });

  it('returns one linked player, and nothing for an unlinked one', async () => {
    const { foreign } = await seedTwoCoaches();
    expect(await coachPlayer(db, 'd', 'ruta')).toEqual({
      id: 'ruta',
      displayName: 'Rūta',
      linkedAt: T0,
      groups: [{ id: foreign, name: 'Kita' }],
    });
    expect(await coachPlayer(db, 'c', 'jonas')).toEqual({
      id: 'jonas',
      displayName: 'Jonas',
      linkedAt: NOW,
      groups: [],
    });
    expect(await coachPlayer(db, 'd', 'jonas')).toBeUndefined();
    expect(await coachPlayer(db, 'c', 'lone')).toBeUndefined();
  });
});

describe('linked accounts in Lithuanian order (R-160)', () => {
  it("lists the coach's players, and each player's groups, by Lithuanian name", async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    const players = await seedNamedAccounts(db, 'p', UNSORTED_NAMES);
    for (const player of players) await seedLink(db, 'c', player);
    for (const name of UNSORTED_NAMES) {
      const group = await seedGroup(db, 'c', name);
      await seedMember(db, 'c', group, 'p-1');
    }
    const listed = await coachPlayers(db, 'c');
    expect(listed.map((player) => player.displayName)).toEqual(
      LITHUANIAN_ORDER,
    );
    const jonas = listed.find((player) => player.id === 'p-1');
    expect(jonas?.groups.map((group) => group.name)).toEqual(LITHUANIAN_ORDER);
  });

  it("lists the player's coaches by Lithuanian name", async () => {
    await seedPlayer(db, 'ruta', 'ruta@example.lt');
    const coaches = await seedNamedAccounts(db, 'c', UNSORTED_NAMES, true);
    for (const coach of coaches) await seedLink(db, coach, 'ruta');
    expect(
      (await playerCoaches(db, 'ruta')).map((coach) => coach.displayName),
    ).toEqual(LITHUANIAN_ORDER);
  });
});

describe('playerCoaches', () => {
  it("lists the player's coaches by name with the player's groups of each", async () => {
    const { saturday, advanced, foreign } = await seedTwoCoaches();
    expect(await playerCoaches(db, 'ruta')).toEqual([
      {
        id: 'c',
        displayName: 'Coach C',
        linkedAt: T0,
        groups: [
          { id: advanced, name: 'Pažengę' },
          { id: saturday, name: 'Šeštadienis' },
        ],
      },
      {
        id: 'd',
        displayName: 'Coach D',
        linkedAt: T0,
        groups: [{ id: foreign, name: 'Kita' }],
      },
    ]);
    expect(await playerCoaches(db, 'jonas')).toEqual([
      { id: 'c', displayName: 'Coach C', linkedAt: NOW, groups: [] },
    ]);
    expect(await playerCoaches(db, 'lone')).toEqual([]);
  });
});

describe('unlink', () => {
  it("ends the link and the player's memberships in that coach's groups only (R-39)", async () => {
    const { foreign } = await seedTwoCoaches();
    expect(await unlink(db, 'c', 'ruta', NOW)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      await query('select coach_id, player_id from coach_links order by 1, 2'),
    ).toEqual([
      { coach_id: 'c', player_id: 'jonas' },
      { coach_id: 'd', player_id: 'ruta' },
    ]);
    expect(
      await query('select group_id, player_id from group_members'),
    ).toEqual([{ group_id: foreign, player_id: 'ruta' }]);
    expect(await query('select count(*)::int as n from groups')).toEqual([
      { n: 3 },
    ]);
    expect(await unlink(db, 'c', 'ruta', NOW)).toEqual(
      refused(COACH_REFUSALS.notLinked),
    );
  });

  it('does nothing for the pair the other way round', async () => {
    await seedTwoCoaches();
    expect(await unlink(db, 'ruta', 'c', NOW)).toEqual(
      refused(COACH_REFUSALS.notLinked),
    );
    expect(await coachPlayer(db, 'c', 'ruta')).toBeDefined();
  });

  it("ends the coach's assignments to the player with a fork offer (R-44)", async () => {
    const { saturday: group } = await seedTwoCoaches();
    const rep = await seedRepertoire(db, 'c', T0);
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: rep,
      target: { playerId: 'ruta' },
      now: T0,
    });
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: rep,
      target: { groupId: group },
      now: T0,
    });
    expect(await unlink(db, 'c', 'ruta', NOW)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await offersOf(db)).toEqual([
      {
        playerId: 'ruta',
        repertoireId: rep,
        reason: 'unlinked',
        closedAt: null,
      },
    ]);
    expect(await query('select player_id, group_id from assignments')).toEqual([
      { player_id: null, group_id: group },
    ]);
  });

  it('waits for the coach row, so an assignment made meanwhile is offered too', async () => {
    await seedTwoCoaches();
    const rep = await seedRepertoire(db, 'c', T0);
    const assigning = await openTransaction(client, [
      `select id from accounts where id = 'c' for no key update`,
      `insert into assignments (coach_id, repertoire_id, player_id, assigned_version, created_at)
       values ('c', '${rep}', 'ruta', 1, now())`,
    ]);
    const unlinking = unlink(db, 'c', 'ruta', NOW);
    await someoneWaitsForALock(client);
    await assigning.finish();
    expect(await unlinking).toEqual({ ok: true, value: undefined });
    expect(await offersOf(db)).toEqual([
      {
        playerId: 'ruta',
        repertoireId: rep,
        reason: 'unlinked',
        closedAt: null,
      },
    ]);
  });
});

describe('coachAccessFacts', () => {
  it('says whether the coach is linked to the player now (checklist 3)', async () => {
    await seedTwoCoaches();
    expect(await coachAccessFacts(db, 'c', 'ruta')).toEqual({
      linked: true,
      sharedRepertoireIds: new Set(),
    });
    expect(await coachAccessFacts(db, 'ruta', 'c')).toEqual({
      linked: false,
      sharedRepertoireIds: new Set(),
    });
    expect(await coachAccessFacts(db, 'd', 'jonas')).toMatchObject({
      linked: false,
    });
    await unlink(db, 'c', 'ruta', NOW);
    expect(await coachAccessFacts(db, 'c', 'ruta')).toMatchObject({
      linked: false,
    });
  });
});
