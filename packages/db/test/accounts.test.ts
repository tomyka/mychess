import { describe, expect, it } from 'vitest';
import {
  acceptInvite,
  completeOnboarding,
  createInvite,
  deleteAccount,
  exportAccount,
  findAccountByEmail,
  findAccountById,
  inviteTokenHash,
  revokeInvite,
  updateProfile,
} from '../src';
import { providerAccounts, sessions } from '../src/schema';
import { useTestDatabase } from '../src/testing';
import { seedAccount, seedVerification } from './support/accounts';
import { seedCoach, seedGroup, seedPlayer } from './support/coaching';

const { db, client } = useTestDatabase();
const T0 = new Date('2026-10-16T08:00:00Z');
const NOW = new Date('2026-10-16T09:00:00Z');

const counts = async (): Promise<unknown> =>
  (
    await client.query(`select
      (select count(*) from accounts)::int as accounts,
      (select count(*) from sessions)::int as sessions,
      (select count(*) from provider_accounts)::int as providers,
      (select count(*) from verifications)::int as verifications`)
  ).rows[0];

const verificationIds = async (): Promise<unknown> =>
  (await client.query('select id from verifications order by id')).rows.map(
    (row: { id: string }) => row.id,
  );

const accountRows = async (): Promise<unknown> =>
  (
    await client.query(
      'select id, display_name, locale, onboarded_at, updated_at from accounts order by id',
    )
  ).rows;

describe('findAccountById / findAccountByEmail', () => {
  it('returns the parsed account', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await seedAccount(db, 'a2', 'jonas@example.lt');
    const account = await findAccountById(db, 'a1');
    expect(account).toEqual({
      id: 'a1',
      email: 'ruta@example.lt',
      emailVerified: true,
      displayName: 'a1',
      locale: 'lt',
      entitlement: 'free',
      admin: false,
      disabledAt: null,
      onboardedAt: null,
      coachSince: null,
      createdAt: T0,
    });
    expect(await findAccountByEmail(db, 'ruta@example.lt')).toEqual(account);
    expect(await findAccountByEmail(db, 'jonas@example.lt')).toMatchObject({
      id: 'a2',
    });
  });

  it('says whether the email was proven (R-87)', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await client.query('update accounts set email_verified = false');
    expect(await findAccountById(db, 'a1')).toMatchObject({
      emailVerified: false,
    });
  });

  it('returns undefined for an unknown account', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    expect(await findAccountById(db, 'nobody')).toBeUndefined();
    expect(await findAccountByEmail(db, 'nobody@example.lt')).toBeUndefined();
  });
});

describe('completeOnboarding and updateProfile', () => {
  it('sets the name, the language and the onboarding time of that account only', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await seedAccount(db, 'a2', 'jonas@example.lt');
    await completeOnboarding(
      db,
      'a1',
      { displayName: 'Rūta', locale: 'en' },
      NOW,
    );
    expect(await accountRows()).toEqual([
      {
        id: 'a1',
        display_name: 'Rūta',
        locale: 'en',
        onboarded_at: NOW,
        updated_at: NOW,
      },
      {
        id: 'a2',
        display_name: 'a2',
        locale: 'lt',
        onboarded_at: null,
        updated_at: T0,
      },
    ]);
  });

  it('changes the name and the language of that account only, without touching onboarding', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await seedAccount(db, 'a2', 'jonas@example.lt');
    await updateProfile(
      db,
      'a1',
      { displayName: 'Rūta K.', locale: 'en' },
      NOW,
    );
    expect(await accountRows()).toEqual([
      {
        id: 'a1',
        display_name: 'Rūta K.',
        locale: 'en',
        onboarded_at: null,
        updated_at: NOW,
      },
      {
        id: 'a2',
        display_name: 'a2',
        locale: 'lt',
        onboarded_at: null,
        updated_at: T0,
      },
    ]);
  });
});

describe('deleteAccount', () => {
  it('removes the account, its sessions, links and magic-link tokens, and nobody else', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await seedAccount(db, 'a2', 'jonas@example.lt');
    await deleteAccount(db, 'a1');
    expect(await counts()).toEqual({
      accounts: 1,
      sessions: 1,
      providers: 1,
      verifications: 1,
    });
    expect(await findAccountById(db, 'a1')).toBeUndefined();
    expect(await findAccountById(db, 'a2')).toBeDefined();
    expect(await verificationIds()).toEqual(['v-a2']);
  });

  it('removes every token for the email and keeps rows that are not JSON objects or name another email', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await seedVerification(
      db,
      'v-second',
      ' {"email":"ruta@example.lt","name":""}',
    );
    await seedVerification(db, 'v-plain', 'ruta@example.lt');
    await seedVerification(db, 'v-broken', '{ruta@example.lt');
    await seedVerification(db, 'v-scalar', '"ruta@example.lt"');
    await seedVerification(db, 'v-array', '["ruta@example.lt"]');
    await seedVerification(db, 'v-no-email', '{"state":"ruta@example.lt"}');
    await seedVerification(db, 'v-other', '{"email":"jonas@example.lt"}');
    await deleteAccount(db, 'a1');
    expect(await verificationIds()).toEqual([
      'v-array',
      'v-broken',
      'v-no-email',
      'v-other',
      'v-plain',
      'v-scalar',
    ]);
  });

  it('removes a token whose email differs only in case and outer spaces', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await seedVerification(db, 'v-mixed', '{"email":"  Ruta@Example.LT "}');
    await seedVerification(db, 'v-other', '{"email":" Jonas@Example.lt"}');
    await deleteAccount(db, 'a1');
    expect(await verificationIds()).toEqual(['v-other']);
  });

  it('does nothing for an unknown account', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await deleteAccount(db, 'nobody');
    expect(await counts()).toEqual({
      accounts: 1,
      sessions: 1,
      providers: 1,
      verifications: 1,
    });
  });
});

describe('exportAccount', () => {
  it('holds the profile and linked providers of the requester only, never tokens', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await seedAccount(db, 'a2', 'jonas@example.lt');
    await db.insert(providerAccounts).values({
      id: 'p-a1-google',
      providerAccountId: 'google-a1',
      providerId: 'google',
      ownerAccountId: 'a1',
      accessToken: 'encrypted',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const data = await exportAccount(db, 'a1', NOW);
    expect(data).toEqual({
      account: {
        email: 'ruta@example.lt',
        displayName: 'a1',
        locale: 'lt',
        image: null,
        entitlement: 'free',
        onboardedAt: null,
        coachSince: null,
        createdAt: '2026-10-16T08:00:00.000Z',
      },
      linkedProviders: [
        { provider: 'lichess', linkedAt: '2026-10-16T08:00:00.000Z' },
        { provider: 'google', linkedAt: '2026-10-16T09:00:00.000Z' },
      ],
      sessions: [
        {
          ipAddress: null,
          userAgent: null,
          createdAt: '2026-10-16T08:00:00.000Z',
          expiresAt: '2027-01-14T08:00:00.000Z',
        },
      ],
      coaching: { coaches: [], groups: [], invites: [] },
    });
    expect(JSON.stringify(data)).not.toMatch(/encrypted|jonas|t-a1/);
  });

  it('holds the picture and the onboarding time once they are set', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await client.query(
      `update accounts set image = 'https://example.lt/ruta.png' where id = 'a1'`,
    );
    await completeOnboarding(
      db,
      'a1',
      { displayName: 'Rūta', locale: 'en' },
      NOW,
    );
    expect((await exportAccount(db, 'a1', NOW))?.account).toEqual({
      email: 'ruta@example.lt',
      displayName: 'Rūta',
      locale: 'en',
      image: 'https://example.lt/ruta.png',
      entitlement: 'free',
      onboardedAt: '2026-10-16T09:00:00.000Z',
      coachSince: null,
      createdAt: '2026-10-16T08:00:00.000Z',
    });
  });

  it("holds only the requester's active sessions, oldest first, never a token (R-89)", async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await seedAccount(db, 'a2', 'jonas@example.lt');
    await db.insert(sessions).values([
      {
        id: 's-a1-phone',
        token: 'secret-phone',
        accountId: 'a1',
        expiresAt: new Date('2026-10-23T09:00:00Z'),
        ipAddress: '192.0.2.7',
        userAgent: 'Firefox',
        createdAt: new Date('2026-10-16T07:00:00Z'),
        updatedAt: NOW,
      },
      {
        id: 's-a1-expired',
        token: 'secret-expired',
        accountId: 'a1',
        expiresAt: new Date('2026-10-16T08:59:59Z'),
        ipAddress: '192.0.2.8',
        userAgent: 'Old browser',
        createdAt: new Date('2026-10-01T09:00:00Z'),
        updatedAt: NOW,
      },
      {
        id: 's-a1-ends-now',
        token: 'secret-ends-now',
        accountId: 'a1',
        expiresAt: NOW,
        createdAt: new Date('2026-10-02T09:00:00Z'),
        updatedAt: NOW,
      },
    ]);
    const data = await exportAccount(db, 'a1', NOW);
    expect(data?.sessions).toEqual([
      {
        ipAddress: '192.0.2.7',
        userAgent: 'Firefox',
        createdAt: '2026-10-16T07:00:00.000Z',
        expiresAt: '2026-10-23T09:00:00.000Z',
      },
      {
        ipAddress: null,
        userAgent: null,
        createdAt: '2026-10-16T08:00:00.000Z',
        expiresAt: '2027-01-14T08:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(data)).not.toMatch(
      /secret|t-a1|t-a2|s-a1|Old browser|192\.0\.2\.8/,
    );
  });

  it('returns undefined for an unknown account', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    expect(await exportAccount(db, 'nobody', NOW)).toBeUndefined();
  });
});

describe('coaching rows on delete and export', () => {
  const LATER = new Date('2026-10-16T10:00:00Z');
  const WEEK = 7 * 24 * 60 * 60 * 1000;

  const coachingCounts = async (): Promise<unknown> =>
    (
      await client.query(`select
        (select count(*) from coach_links)::int as links,
        (select count(*) from groups)::int as groups,
        (select count(*) from group_members)::int as members,
        (select count(*) from invites)::int as invites`)
    ).rows[0];

  const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
  const iso = (seconds: number) => at(seconds).toISOString();
  const expiry = (seconds: number) =>
    new Date(at(seconds).getTime() + WEEK).toISOString();

  async function invite(
    kind: 'personal' | 'group',
    groupId: string | null,
    now: Date,
  ) {
    const made = await createInvite(db, { coachId: 'c', kind, groupId, now });
    if (!made.ok) throw new Error(made.refusal.reason);
    return { ...made.value, hash: inviteTokenHash(made.value.token) };
  }

  /**
   * Coach c (display name "Treneris") with players p1 and p2 in "Mano";
   * p1 used a personal invite, a group invite is open, and one more
   * personal invite is revoked.
   */
  async function seedCoaching() {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedPlayer(db, 'p1', 'p1@example.lt');
    await seedPlayer(db, 'p2', 'p2@example.lt');
    await client.query(
      `update accounts set display_name = 'Treneris' where id = 'c'`,
    );
    const groupId = await seedGroup(db, 'c', 'Mano');
    const personal = await invite('personal', null, at(0));
    const group = await invite('group', groupId, at(1));
    const revoked = await invite('personal', null, at(2));
    await acceptInvite(db, personal.hash, 'p1', NOW);
    await acceptInvite(db, group.hash, 'p1', NOW);
    await acceptInvite(db, group.hash, 'p2', LATER);
    await revokeInvite(db, 'c', revoked.inviteId, LATER);
    return { personal, group, revoked };
  }

  it('deleting a coach removes their links, groups, memberships and invites, and no player', async () => {
    await seedCoaching();
    await deleteAccount(db, 'c');
    expect(await coachingCounts()).toEqual({
      links: 0,
      groups: 0,
      members: 0,
      invites: 0,
    });
    expect(await findAccountById(db, 'p1')).toBeDefined();
    expect(await findAccountById(db, 'p2')).toBeDefined();
  });

  it('deleting a player removes their link and memberships and keeps the used invite without them', async () => {
    await seedCoaching();
    await deleteAccount(db, 'p1');
    expect(
      (await client.query('select player_id from coach_links')).rows,
    ).toEqual([{ player_id: 'p2' }]);
    expect(
      (await client.query('select player_id from group_members')).rows,
    ).toEqual([{ player_id: 'p2' }]);
    expect(
      (
        await client.query(
          `select used_by, used_at from invites where kind = 'personal' and used_at is not null`,
        )
      ).rows,
    ).toEqual([{ used_by: null, used_at: NOW }]);
    expect(await coachingCounts()).toMatchObject({ groups: 1, invites: 3 });
  });

  it("exports a player's coach links with their groups (R-106)", async () => {
    await seedCoaching();
    const data = await exportAccount(db, 'p1', LATER);
    expect(data?.account.coachSince).toBeNull();
    expect(data?.coaching).toEqual({
      coaches: [
        {
          displayName: 'Treneris',
          linkedAt: NOW.toISOString(),
          groups: ['Mano'],
        },
      ],
      groups: [],
      invites: [],
    });
  });

  it("exports a coach's groups and invites with their state and dates, never a token (R-106)", async () => {
    const { personal, group, revoked } = await seedCoaching();
    const data = await exportAccount(db, 'c', LATER);
    expect(data?.account.coachSince).toBe(T0.toISOString());
    expect(data?.coaching).toEqual({
      coaches: [],
      groups: [{ name: 'Mano', createdAt: T0.toISOString() }],
      invites: [
        {
          kind: 'personal',
          groupName: null,
          state: 'used',
          createdAt: iso(0),
          expiresAt: expiry(0),
          revokedAt: null,
          usedAt: NOW.toISOString(),
        },
        {
          kind: 'group',
          groupName: 'Mano',
          state: 'active',
          createdAt: iso(1),
          expiresAt: expiry(1),
          revokedAt: null,
          usedAt: null,
        },
        {
          kind: 'personal',
          groupName: null,
          state: 'revoked',
          createdAt: iso(2),
          expiresAt: expiry(2),
          revokedAt: LATER.toISOString(),
          usedAt: null,
        },
      ],
    });
    const text = JSON.stringify(data);
    for (const made of [personal, group, revoked]) {
      expect(text).not.toContain(made.token);
      expect(text).not.toContain(made.hash);
      expect(text).not.toContain(made.inviteId);
    }
    expect(text).not.toMatch(/p1|p2/);
  });
});
