import {
  COACH_REFUSALS,
  INVITE_REFUSALS,
  type InviteKind,
} from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import {
  acceptInvite,
  coachInvites,
  createInvite,
  inviteTokenHash,
  previewInvite,
  revokeInvite,
} from '../src';
import { useTestDatabase } from '../src/testing';
import {
  openTransaction,
  seedCoach,
  seedGroup,
  seedLink,
  seedLinks,
  seedPlayer,
  someoneWaitsForALock,
  T0,
} from './support/coaching';

const { db, client } = useTestDatabase();

const NOW = new Date('2026-10-16T09:00:00Z');
const WEEK = 7 * 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

/** Makes an invite and returns its raw token (and id). */
async function invite(
  kind: InviteKind = 'personal',
  groupId: string | null = null,
  coachId = 'c',
  now = NOW,
): Promise<{ token: string; inviteId: string; hash: string }> {
  const made = await createInvite(db, { coachId, kind, groupId, now });
  if (!made.ok) throw new Error(made.refusal.reason);
  return { ...made.value, hash: inviteTokenHash(made.value.token) };
}

const accept = (hash: string, playerId: string, now = NOW) =>
  acceptInvite(db, hash, playerId, now);

const query = async (
  text: string,
  params: unknown[] = [],
): Promise<unknown[]> =>
  (await client.query<Record<string, unknown>>(text, params)).rows;

const linksOf = async (coachId: string): Promise<number> =>
  must(
    (
      await client.query<{ n: number }>(
        'select count(*)::int as n from coach_links where coach_id = $1',
        [coachId],
      )
    ).rows[0],
  ).n;

const refused = (reason: string) => ({ ok: false, refusal: { reason } });

describe('createInvite', () => {
  it('returns the raw token once and stores only its hash, valid for 7 days', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    const made = await createInvite(db, {
      coachId: 'c',
      kind: 'personal',
      groupId: null,
      now: NOW,
    });
    if (!made.ok) throw new Error('refused');
    const { token, inviteId } = made.value;
    expect(await query('select id, token_hash from invites')).toEqual([
      { id: inviteId, token_hash: inviteTokenHash(token) },
    ]);
    expect(
      await query(
        'select count(*)::int as n from invites where token_hash = $1',
        [token],
      ),
    ).toEqual([{ n: 0 }]);
    expect(
      await query(
        'select coach_id, kind, group_id, created_at, expires_at, revoked_at, used_at, used_by from invites',
      ),
    ).toEqual([
      {
        coach_id: 'c',
        kind: 'personal',
        group_id: null,
        created_at: NOW,
        expires_at: at(WEEK),
        revoked_at: null,
        used_at: null,
        used_by: null,
      },
    ]);
  });

  it("makes a group invite for the coach's own group (R-110)", async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    const groupId = await seedGroup(db, 'c', 'Šeštadienio grupė');
    await invite('group', groupId);
    expect(await query('select kind, group_id from invites')).toEqual([
      { kind: 'group', group_id: groupId },
    ]);
  });

  it('refuses an account without Coach mode', async () => {
    await seedPlayer(db, 'p', 'p@example.lt');
    expect(
      await createInvite(db, {
        coachId: 'p',
        kind: 'personal',
        groupId: null,
        now: NOW,
      }),
    ).toEqual(refused(COACH_REFUSALS.notCoach));
    expect(await query('select id from invites')).toEqual([]);
  });

  it('refuses an unknown account', async () => {
    expect(
      await createInvite(db, {
        coachId: 'nobody',
        kind: 'personal',
        groupId: null,
        now: NOW,
      }),
    ).toEqual(refused(COACH_REFUSALS.notCoach));
  });

  it("refuses another coach's group and inserts nothing", async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedCoach(db, 'c2', 'coach2@example.lt');
    const foreign = await seedGroup(db, 'c2', 'Kita');
    for (const kind of ['group', 'personal'] as const)
      expect(
        await createInvite(db, {
          coachId: 'c',
          kind,
          groupId: foreign,
          now: NOW,
        }),
      ).toEqual(refused(COACH_REFUSALS.groupNotFound));
    expect(await query('select id from invites')).toEqual([]);
  });
});

describe('acceptInvite', () => {
  it('links the player through a group invite, adds the membership and keeps the invite open (R-98)', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    await seedPlayer(db, 'p2', 'p2@example.lt');
    const groupId = await seedGroup(db, 'c', 'Šeštadienio grupė');
    const { hash } = await invite('group', groupId);
    expect(await accept(hash, 'p1')).toEqual({
      ok: true,
      value: { coachId: 'c', groupId },
    });
    expect(await accept(hash, 'p2')).toEqual({
      ok: true,
      value: { coachId: 'c', groupId },
    });
    expect(
      await query(
        'select coach_id, player_id, created_at from coach_links order by player_id',
      ),
    ).toEqual([
      { coach_id: 'c', player_id: 'p1', created_at: NOW },
      { coach_id: 'c', player_id: 'p2', created_at: NOW },
    ]);
    expect(
      await query(
        'select group_id, player_id, joined_at from group_members order by player_id',
      ),
    ).toEqual([
      { group_id: groupId, player_id: 'p1', joined_at: NOW },
      { group_id: groupId, player_id: 'p2', joined_at: NOW },
    ]);
    expect(await query('select used_at, used_by from invites')).toEqual([
      { used_at: null, used_by: null },
    ]);
  });

  it('uses a personal invite once (checklist 5)', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    await seedPlayer(db, 'p2', 'p2@example.lt');
    const { hash } = await invite();
    expect(await accept(hash, 'p1')).toEqual({
      ok: true,
      value: { coachId: 'c', groupId: null },
    });
    expect(await accept(hash, 'p2', at(1000))).toEqual(
      refused(INVITE_REFUSALS.invalid),
    );
    expect(await query('select used_at, used_by from invites')).toEqual([
      { used_at: NOW, used_by: 'p1' },
    ]);
    expect(await query('select player_id from coach_links')).toEqual([
      { player_id: 'p1' },
    ]);
    expect(await query('select player_id from group_members')).toEqual([]);
  });

  it('puts the player into the group a personal invite names (R-110)', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const groupId = await seedGroup(db, 'c', 'Mano');
    const { hash } = await invite('personal', groupId);
    expect(await accept(hash, 'p1')).toEqual({
      ok: true,
      value: { coachId: 'c', groupId },
    });
    expect(await query('select player_id from group_members')).toEqual([
      { player_id: 'p1' },
    ]);
  });

  it.each([
    ['expired, at the expiry', 'expired'],
    ['revoked', 'revoked'],
    ['unknown', 'unknown'],
  ])('refuses an invite that is %s and changes nothing', async (_, how) => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const { hash, inviteId } = await invite();
    if (how === 'revoked') await revokeInvite(db, 'c', inviteId, NOW);
    const before = await query('select * from invites');
    const result =
      how === 'expired'
        ? await accept(hash, 'p1', at(WEEK))
        : await accept(how === 'unknown' ? 'f'.repeat(64) : hash, 'p1');
    expect(result).toEqual(refused(INVITE_REFUSALS.invalid));
    expect(await query('select * from invites')).toEqual(before);
    expect(await linksOf('c')).toBe(0);
  });

  it('accepts an invite just before its expiry', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const { hash } = await invite();
    expect((await accept(hash, 'p1', at(WEEK - 1))).ok).toBe(true);
  });

  it('refuses the raw token in place of its hash', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const { token } = await invite();
    expect(await accept(token, 'p1')).toEqual(refused(INVITE_REFUSALS.invalid));
  });

  it('refuses an invite whose coach is not the coach it locked', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedCoach(db, 'c2', 'coach2@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const { hash } = await invite();
    // acceptInvite learns coach 'c' unlocked, then waits for c's row; the
    // invite moves to 'c2' meanwhile, so c's lock no longer covers it.
    const holding = await openTransaction(client, [
      `select id from accounts where id = 'c' for no key update`,
    ]);
    const accepting = accept(hash, 'p1');
    await someoneWaitsForALock(client);
    await holding.finish(`update invites set coach_id = 'c2'`);
    expect(await accepting).toEqual(refused(INVITE_REFUSALS.invalid));
    expect(await query('select coach_id, player_id from coach_links')).toEqual(
      [],
    );
  });

  it("refuses the coach's own invite", async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    const { hash } = await invite();
    expect(await accept(hash, 'c')).toEqual(refused(INVITE_REFUSALS.ownInvite));
    expect(await query('select used_by from invites')).toEqual([
      { used_by: null },
    ]);
  });

  it('refuses an invite from a disabled coach as not valid (R-108)', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const { hash } = await invite();
    await client.query(`update accounts set disabled_at = $1 where id = 'c'`, [
      NOW,
    ]);
    expect(await accept(hash, 'p1')).toEqual(refused(INVITE_REFUSALS.invalid));
    expect(await linksOf('c')).toBe(0);
  });

  it('refuses an invite from an account that left Coach mode', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const { hash } = await invite();
    await client.query(`update accounts set coach_since = null`);
    expect(await accept(hash, 'p1')).toEqual(refused(INVITE_REFUSALS.notCoach));
  });

  it('refuses the 31st player (R-70)', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedLinks(db, 'c', 30);
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const { hash } = await invite();
    expect(await accept(hash, 'p1')).toEqual(
      refused(INVITE_REFUSALS.coachFull),
    );
    expect(await linksOf('c')).toBe(30);
    expect(await query('select used_by from invites')).toEqual([
      { used_by: null },
    ]);
  });

  it('adds an already linked player to the group without a second link, even at 30 players', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedLinks(db, 'c', 30);
    const groupId = await seedGroup(db, 'c', 'Mano');
    const { hash } = await invite('group', groupId);
    expect(await accept(hash, 'c-p-1')).toEqual({
      ok: true,
      value: { coachId: 'c', groupId },
    });
    expect(await linksOf('c')).toBe(30);
    expect(await query('select player_id from group_members')).toEqual([
      { player_id: 'c-p-1' },
    ]);
    expect(
      await query(
        `select created_at from coach_links where player_id = 'c-p-1'`,
      ),
    ).toEqual([{ created_at: T0 }]);
  });

  it('marks a personal invite used by an already linked player', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    await seedLink(db, 'c', 'p1');
    const { hash } = await invite();
    expect((await accept(hash, 'p1')).ok).toBe(true);
    expect(await query('select used_by from invites')).toEqual([
      { used_by: 'p1' },
    ]);
  });

  it('accepting a group the player is already in changes nothing', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const groupId = await seedGroup(db, 'c', 'Mano');
    const { hash } = await invite('group', groupId);
    await accept(hash, 'p1');
    expect((await accept(hash, 'p1', at(1000))).ok).toBe(true);
    expect(await query('select joined_at from group_members')).toEqual([
      { joined_at: NOW },
    ]);
  });

  // Each run starts from scratch, so an unlocked implementation that slips
  // through once is caught on another run.
  it.each([1, 2, 3, 4, 5])(
    'lets only one of two players in at 29 players, run %i (plan decision 1)',
    async (run) => {
      const coach = `c${String(run)}`;
      await seedCoach(db, coach, `${coach}@example.lt`);
      await seedLinks(db, coach, 29);
      await seedPlayer(db, `${coach}-a`, `${coach}-a@example.lt`);
      await seedPlayer(db, `${coach}-b`, `${coach}-b@example.lt`);
      const first = await invite('personal', null, coach);
      const second = await invite('personal', null, coach);
      const results = await Promise.all([
        accept(first.hash, `${coach}-a`),
        accept(second.hash, `${coach}-b`),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([
        refused(INVITE_REFUSALS.coachFull),
      ]);
      expect(await linksOf(coach)).toBe(30);
    },
  );

  it.each([1, 2, 3, 4, 5])(
    'lets only one of two players use a personal invite at once, run %i',
    async (run) => {
      const coach = `c${String(run)}`;
      await seedCoach(db, coach, `${coach}@example.lt`);
      await seedPlayer(db, `${coach}-a`, `${coach}-a@example.lt`);
      await seedPlayer(db, `${coach}-b`, `${coach}-b@example.lt`);
      const { hash } = await invite('personal', null, coach);
      const results = await Promise.all([
        accept(hash, `${coach}-a`),
        accept(hash, `${coach}-b`),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([
        refused(INVITE_REFUSALS.invalid),
      ]);
      expect(await linksOf(coach)).toBe(1);
    },
  );
});

describe('revokeInvite', () => {
  it("revokes the coach's own invite", async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    const { inviteId } = await invite();
    expect(await revokeInvite(db, 'c', inviteId, at(1000))).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await query('select revoked_at from invites')).toEqual([
      { revoked_at: at(1000) },
    ]);
  });

  it("refuses another coach's invite and changes nothing", async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedCoach(db, 'c2', 'coach2@example.lt');
    const { inviteId } = await invite();
    expect(await revokeInvite(db, 'c2', inviteId, NOW)).toEqual(
      refused(INVITE_REFUSALS.invalid),
    );
    expect(await query('select revoked_at from invites')).toEqual([
      { revoked_at: null },
    ]);
  });

  it('refuses a malformed invite id', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await invite();
    expect(await revokeInvite(db, 'c', 'not-a-uuid', NOW)).toEqual(
      refused(INVITE_REFUSALS.invalid),
    );
  });

  it('refuses a second revoke and keeps the first time', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    const { inviteId } = await invite();
    await revokeInvite(db, 'c', inviteId, NOW);
    expect(await revokeInvite(db, 'c', inviteId, at(1000))).toEqual(
      refused(INVITE_REFUSALS.invalid),
    );
    expect(await query('select revoked_at from invites')).toEqual([
      { revoked_at: NOW },
    ]);
  });
});

describe('previewInvite', () => {
  it("shows an active invite's coach and group", async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const groupId = await seedGroup(db, 'c', 'Šeštadienio grupė');
    const { hash } = await invite('group', groupId);
    expect(await previewInvite(db, hash, 'p1', NOW)).toEqual({
      ok: true,
      value: {
        coachDisplayName: 'Name c',
        groupName: 'Šeštadienio grupė',
        kind: 'group',
      },
    });
    expect(await linksOf('c')).toBe(0);
  });

  it('shows a personal invite without a group', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const { hash } = await invite();
    expect(await previewInvite(db, hash, 'p1', NOW)).toEqual({
      ok: true,
      value: { coachDisplayName: 'Name c', groupName: null, kind: 'personal' },
    });
  });

  it.each(['unknown', 'expired', 'used', 'revoked'])(
    'answers the same "not valid" for a %s invite',
    async (how) => {
      await seedCoach(db, 'c', 'coach@example.lt');
      await seedPlayer(db, 'p1', 'p1@example.lt');
      await seedPlayer(db, 'p2', 'p2@example.lt');
      const { hash, inviteId } = await invite();
      if (how === 'used') await accept(hash, 'p2');
      if (how === 'revoked') await revokeInvite(db, 'c', inviteId, NOW);
      const asked = how === 'unknown' ? 'e'.repeat(64) : hash;
      const now = how === 'expired' ? at(WEEK) : NOW;
      expect(await previewInvite(db, asked, 'p1', now)).toEqual(
        refused(INVITE_REFUSALS.invalid),
      );
    },
  );

  it("passes the coach's other refusals through", async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedLinks(db, 'c', 30);
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const { hash } = await invite();
    expect(await previewInvite(db, hash, 'c', NOW)).toEqual(
      refused(INVITE_REFUSALS.ownInvite),
    );
    expect(await previewInvite(db, hash, 'p1', NOW)).toEqual(
      refused(INVITE_REFUSALS.coachFull),
    );
    expect(await previewInvite(db, hash, 'c-p-1', NOW)).toMatchObject({
      ok: true,
    });
  });
});

describe('coachInvites', () => {
  it("lists only the coach's invites, newest first, with their state and never a token", async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedCoach(db, 'c2', 'coach2@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const groupId = await seedGroup(db, 'c', 'Mano');
    const old = await invite('personal', null, 'c', at(-WEEK));
    const used = await invite('personal', null, 'c', at(1000));
    const revoked = await invite('group', groupId, 'c', at(2000));
    const open = await invite('group', groupId, 'c', at(3000));
    await invite('personal', null, 'c2', at(4000));
    await accept(used.hash, 'p1', at(1000));
    await revokeInvite(db, 'c', revoked.inviteId, at(2500));
    const list = await coachInvites(db, 'c', at(5000));
    expect(list).toEqual([
      {
        id: open.inviteId,
        kind: 'group',
        groupName: 'Mano',
        state: 'active',
        expiresAt: at(3000 + WEEK),
        createdAt: at(3000),
      },
      {
        id: revoked.inviteId,
        kind: 'group',
        groupName: 'Mano',
        state: 'revoked',
        expiresAt: at(2000 + WEEK),
        createdAt: at(2000),
      },
      {
        id: used.inviteId,
        kind: 'personal',
        groupName: null,
        state: 'used',
        expiresAt: at(1000 + WEEK),
        createdAt: at(1000),
      },
      {
        id: old.inviteId,
        kind: 'personal',
        groupName: null,
        state: 'expired',
        expiresAt: NOW,
        createdAt: at(-WEEK),
      },
    ]);
    const text = JSON.stringify(list);
    for (const made of [old, used, revoked, open]) {
      expect(text).not.toContain(made.token);
      expect(text).not.toContain(made.hash);
    }
  });
});
