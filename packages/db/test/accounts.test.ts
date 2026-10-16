import { describe, expect, it } from 'vitest';
import {
  completeOnboarding,
  deleteAccount,
  exportAccount,
  findAccountByEmail,
  findAccountById,
  updateProfile,
} from '../src';
import { providerAccounts } from '../src/schema';
import { useTestDatabase } from '../src/testing';
import { seedAccount, seedVerification } from './support/accounts';

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
      displayName: 'a1',
      locale: 'lt',
      entitlement: 'free',
      admin: false,
      disabledAt: null,
      onboardedAt: null,
      createdAt: T0,
    });
    expect(await findAccountByEmail(db, 'ruta@example.lt')).toEqual(account);
    expect(await findAccountByEmail(db, 'jonas@example.lt')).toMatchObject({
      id: 'a2',
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
      accountId: 'a1',
      accessToken: 'encrypted',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const data = await exportAccount(db, 'a1');
    expect(data).toEqual({
      account: {
        email: 'ruta@example.lt',
        displayName: 'a1',
        locale: 'lt',
        entitlement: 'free',
        createdAt: '2026-10-16T08:00:00.000Z',
      },
      linkedProviders: [
        { provider: 'lichess', linkedAt: '2026-10-16T08:00:00.000Z' },
        { provider: 'google', linkedAt: '2026-10-16T09:00:00.000Z' },
      ],
    });
    expect(JSON.stringify(data)).not.toMatch(/encrypted|jonas|t-a1/);
  });

  it('returns undefined for an unknown account', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    expect(await exportAccount(db, 'nobody')).toBeUndefined();
  });
});
