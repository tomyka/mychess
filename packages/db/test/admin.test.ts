import { describe, expect, it } from 'vitest';
import { disableAccount, findAccountById, grantAdmin } from '../src';
import { useTestDatabase } from '../src/testing';
import { seedAccount } from './support/accounts';

const { db, client } = useTestDatabase();
const T0 = new Date('2026-10-16T08:00:00Z');
const NOW = new Date('2026-10-16T09:00:00Z');

const audit = async (): Promise<unknown> =>
  (
    await client.query(
      'select action, target_account_id, target_email, actor, at from admin_audit order by id',
    )
  ).rows;

const accountFlags = async (): Promise<unknown> =>
  (
    await client.query(
      'select id, admin, disabled_at, updated_at from accounts order by id',
    )
  ).rows;

const sessionOwners = async (): Promise<unknown> =>
  (await client.query('select account_id from sessions order by account_id'))
    .rows;

describe('grantAdmin', () => {
  it('sets the flag and writes exactly one audit row', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await seedAccount(db, 'a2', 'jonas@example.lt');
    expect(await grantAdmin(db, 'ruta@example.lt', 'cli', NOW)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await findAccountById(db, 'a1')).toMatchObject({ admin: true });
    expect(await accountFlags()).toEqual([
      { id: 'a1', admin: true, disabled_at: null, updated_at: NOW },
      { id: 'a2', admin: false, disabled_at: null, updated_at: T0 },
    ]);
    expect(await sessionOwners()).toEqual([
      { account_id: 'a1' },
      { account_id: 'a2' },
    ]);
    expect(await audit()).toEqual([
      {
        action: 'grant-admin',
        target_account_id: 'a1',
        target_email: 'ruta@example.lt',
        actor: 'cli',
        at: NOW,
      },
    ]);
  });

  it('refuses an unknown email and writes nothing', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    expect(await grantAdmin(db, 'nobody@example.lt', 'cli', NOW)).toEqual({
      ok: false,
      refusal: { reason: 'admin.accountNotFound' },
    });
    expect(await accountFlags()).toEqual([
      { id: 'a1', admin: false, disabled_at: null, updated_at: T0 },
    ]);
    expect(await audit()).toEqual([]);
  });
});

describe('disableAccount', () => {
  it('stamps the account, deletes its sessions at once and audits once', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await seedAccount(db, 'a2', 'jonas@example.lt');
    expect(await disableAccount(db, 'ruta@example.lt', 'ops', NOW)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await findAccountById(db, 'a1')).toMatchObject({ disabledAt: NOW });
    expect(await accountFlags()).toEqual([
      { id: 'a1', admin: false, disabled_at: NOW, updated_at: NOW },
      { id: 'a2', admin: false, disabled_at: null, updated_at: T0 },
    ]);
    expect(await sessionOwners()).toEqual([{ account_id: 'a2' }]);
    expect(await audit()).toEqual([
      {
        action: 'disable-account',
        target_account_id: 'a1',
        target_email: 'ruta@example.lt',
        actor: 'ops',
        at: NOW,
      },
    ]);
  });

  it('refuses an account that is already disabled, changes nothing and writes no audit row', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await client.query(
      `update accounts set disabled_at = $1, updated_at = $1 where id = 'a1'`,
      [T0],
    );
    expect(await disableAccount(db, 'ruta@example.lt', 'ops', NOW)).toEqual({
      ok: false,
      refusal: { reason: 'admin.alreadyDisabled' },
    });
    expect(await accountFlags()).toEqual([
      { id: 'a1', admin: false, disabled_at: T0, updated_at: T0 },
    ]);
    expect(await sessionOwners()).toEqual([{ account_id: 'a1' }]);
    expect(await audit()).toEqual([]);
  });

  it('refuses an unknown email, keeps every session and writes nothing', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    expect(await disableAccount(db, 'nobody@example.lt', 'cli', NOW)).toEqual({
      ok: false,
      refusal: { reason: 'admin.accountNotFound' },
    });
    expect(await accountFlags()).toEqual([
      { id: 'a1', admin: false, disabled_at: null, updated_at: T0 },
    ]);
    expect(await sessionOwners()).toEqual([{ account_id: 'a1' }]);
    expect(await audit()).toEqual([]);
  });
});
