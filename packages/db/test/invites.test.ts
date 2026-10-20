import {
  COACH_REFUSALS,
  INVITE_REFUSALS,
  inviteState,
  type InviteKind,
} from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import { allCoachInvites, openInviteCount } from '../src/invites';
import {
  acceptInvite,
  coachInvites,
  createInvite,
  inviteTokenHash,
  previewInvite,
  revokeInvite,
} from '../src';
import { forkOffers } from '../src/assignment-schema';
import { useTestDatabase } from '../src/testing';
import {
  offersOf,
  seedAssignment,
  seedRepertoire,
} from './support/assignments';
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

/**
 * Seeds `count` personal invites of `coachId` with these columns, made one
 * second apart from `createdAt` (T0 by default).
 */
async function seedInvites(
  coachId: string,
  count: number,
  state: {
    expiresAt?: Date;
    revokedAt?: Date;
    usedAt?: Date;
    createdAt?: Date;
  } = {},
): Promise<void> {
  await client.query(
    `insert into invites (coach_id, kind, token_hash, expires_at, revoked_at, used_at, created_at)
     select $1, 'personal', md5($1 || $2 || i) || md5(i::text || $2 || $1), $3, $4, $5,
       $6::timestamptz + i * interval '1 second'
     from generate_series(1, $7::int) as i`,
    [
      coachId,
      JSON.stringify(state),
      state.expiresAt ?? at(WEEK),
      state.revokedAt ?? null,
      state.usedAt ?? null,
      state.createdAt ?? T0,
      count,
    ],
  );
}

const openInvitesOf = async (coachId: string): Promise<unknown[]> =>
  query(
    `select count(*)::int as n from invites
     where coach_id = $1 and revoked_at is null and used_at is null and expires_at > $2`,
    [coachId, NOW],
  );

const personal = (coachId: string) => ({
  coachId,
  kind: 'personal' as const,
  groupId: null,
  now: NOW,
});

describe('createInvite at the open invite limit (R-114: 50)', () => {
  it('refuses the 51st open invite and inserts nothing', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedInvites('c', 49);
    expect((await createInvite(db, personal('c'))).ok).toBe(true);
    expect(await createInvite(db, personal('c'))).toEqual(
      refused(COACH_REFUSALS.inviteLimit),
    );
    expect(await query('select count(*)::int as n from invites')).toEqual([
      { n: 50 },
    ]);
  });

  it('counts neither revoked, used nor expired invites, nor those of another coach', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedCoach(db, 'd', 'd@example.lt');
    await seedInvites('c', 49);
    await seedInvites('c', 1, { revokedAt: T0 });
    await seedInvites('c', 1, { usedAt: T0 });
    // Expired at the very moment of the request: inviteState says expired.
    await seedInvites('c', 1, { expiresAt: NOW });
    await seedInvites('d', 50);
    expect((await createInvite(db, personal('c'))).ok).toBe(true);
    expect(await openInvitesOf('c')).toEqual([{ n: 50 }]);
  });

  it('counts an invite that expires just after the request', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedInvites('c', 49);
    await seedInvites('c', 1, { expiresAt: at(1) });
    expect(await createInvite(db, personal('c'))).toEqual(
      refused(COACH_REFUSALS.inviteLimit),
    );
  });

  it('refuses an account without Coach mode before counting', async () => {
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedInvites('p', 50);
    expect(await createInvite(db, personal('p'))).toEqual(
      refused(COACH_REFUSALS.notCoach),
    );
  });

  // Each run starts from scratch, so an unlocked count that slips through
  // once is caught on another run.
  it.each([1, 2, 3, 4, 5])(
    'ends with exactly 50 open invites when two creations race at 49, run %i',
    async (run) => {
      const coach = `c${String(run)}`;
      await seedCoach(db, coach, `${coach}@example.lt`);
      await seedInvites(coach, 49);
      const results = await Promise.all([
        createInvite(db, personal(coach)),
        createInvite(db, personal(coach)),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([
        refused(COACH_REFUSALS.inviteLimit),
      ]);
      expect(await openInvitesOf(coach)).toEqual([{ n: 50 }]);
    },
  );
});

describe("the SQL open-invite filter and the domain's inviteState", () => {
  // Every state inviteState knows, with the expiry boundaries. A used group
  // invite cannot be stored (invites_used_personal), so it is not here.
  const table: [
    string,
    { expiresAt?: Date; revokedAt?: Date; usedAt?: Date },
  ][] = [
    ['personal, active', {}],
    ['group, active', {}],
    ['personal, expires 1 ms after now', { expiresAt: at(1) }],
    ['personal, expires at now', { expiresAt: NOW }],
    ['group, expired before now', { expiresAt: at(-1) }],
    ['personal, used', { usedAt: T0 }],
    ['personal, used and expired', { usedAt: T0, expiresAt: at(-1) }],
    ['personal, revoked', { revokedAt: T0 }],
    ['group, revoked', { revokedAt: T0 }],
    ['personal, revoked and used', { revokedAt: T0, usedAt: T0 }],
  ];

  it('counts as open exactly the invites inviteState calls active', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    const groupId = await seedGroup(db, 'c', 'Mano');
    for (const [i, [name, s]] of table.entries())
      await client.query(
        `insert into invites (coach_id, kind, group_id, token_hash, expires_at, revoked_at, used_at, created_at)
         values ('c', $1, $2, md5($3) || md5($3 || 'x'), $4, $5, $6, $7)`,
        [
          name.startsWith('group') ? 'group' : 'personal',
          name.startsWith('group') ? groupId : null,
          String(i),
          s.expiresAt ?? at(WEEK),
          s.revokedAt ?? null,
          s.usedAt ?? null,
          T0,
        ],
      );
    const active = (await allCoachInvites(db, 'c')).filter(
      (row) => inviteState(row, NOW) === 'active',
    );
    expect(active).toHaveLength(3);
    expect(await openInviteCount(db, 'c', NOW)).toBe(active.length);
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

  it('refuses an invite from an account that left Coach mode as not valid', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const { hash } = await invite();
    await client.query(`update accounts set coach_since = null`);
    expect(await accept(hash, 'p1')).toEqual(refused(INVITE_REFUSALS.invalid));
    expect(await linksOf('c')).toBe(0);
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

  it('refuses a used invite and leaves it used', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const { hash, inviteId } = await invite();
    expect((await accept(hash, 'p1')).ok).toBe(true);
    const before = await query('select * from invites');
    expect(await revokeInvite(db, 'c', inviteId, at(1000))).toEqual(
      refused(INVITE_REFUSALS.invalid),
    );
    expect(await query('select * from invites')).toEqual(before);
  });

  it('refuses an expired invite and leaves it expired', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    const { inviteId } = await invite();
    expect(await revokeInvite(db, 'c', inviteId, at(WEEK))).toEqual(
      refused(INVITE_REFUSALS.invalid),
    );
    expect(await query('select revoked_at from invites')).toEqual([
      { revoked_at: null },
    ]);
  });

  it('revokes a group invite that has been used, as it stays open', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    const groupId = await seedGroup(db, 'c', 'Grupė');
    const { hash, inviteId } = await invite('group', groupId);
    expect((await accept(hash, 'p1')).ok).toBe(true);
    expect((await revokeInvite(db, 'c', inviteId, at(1000))).ok).toBe(true);
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

  const statesOf = (list: readonly { state: string }[]) =>
    list.reduce<Record<string, number>>(
      (n, i) => ({ ...n, [i.state]: (n[i.state] ?? 0) + 1 }),
      {},
    );

  it('lists every open invite, however many newer closed ones there are (R-114)', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedInvites('c', 30);
    await seedInvites('c', 30, { revokedAt: T0, createdAt: at(-1000) });
    const list = await coachInvites(db, 'c', NOW);
    expect(statesOf(list)).toEqual({ active: 30, revoked: 30 });
    expect(list.map((i) => i.createdAt)).toEqual(
      list.map((i) => i.createdAt).sort((a, b) => b.getTime() - a.getTime()),
    );
  });

  it('lists only the 50 newest closed invites, dropping the oldest closed one', async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedInvites('c', 1);
    await seedInvites('c', 49, { revokedAt: T0, createdAt: at(-1000) });
    await seedInvites('c', 1, { usedAt: T0, createdAt: at(-500) });
    // The oldest closed invite: expired, and made before the others.
    await seedInvites('c', 1, { expiresAt: NOW, createdAt: at(-WEEK) });
    const list = await coachInvites(db, 'c', NOW);
    expect(statesOf(list)).toEqual({ active: 1, revoked: 49, used: 1 });
    expect(list.at(-1)?.state).toBe('active');
  });
});

describe("acceptInvite and the group's assignments", () => {
  it("gives the group's assignments and closes the player's open offer (R-16, lead decision 4)", async () => {
    await seedCoach(db, 'c', 'coach@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    await seedLink(db, 'c', 'p1');
    const groupId = await seedGroup(db, 'c', 'Šeštadienio grupė');
    const rep = await seedRepertoire(db, 'c', T0);
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: rep,
      target: { groupId },
      now: T0,
    });
    // An offer from an assignment p1 lost earlier.
    await db.insert(forkOffers).values({
      playerId: 'p1',
      repertoireId: rep,
      coachName: 'Name c',
      name: 'Londono sistema',
      side: 'white',
      snapshot: {},
      reason: 'unassigned',
      createdAt: T0,
      expiresAt: at(WEEK),
    });
    const { hash } = await invite('group', groupId);
    expect(await accept(hash, 'p1')).toEqual({
      ok: true,
      value: { coachId: 'c', groupId },
    });
    expect(await offersOf(db)).toEqual([
      {
        playerId: 'p1',
        repertoireId: rep,
        reason: 'unassigned',
        closedAt: NOW,
      },
    ]);
  });
});
