import { describe, expect, it } from 'vitest';
import {
  auditEmailHash,
  disableAccount,
  findAccountById,
  grantAdmin,
} from '../src';
import { TEST_AUDIT_EMAIL_KEY, useTestDatabase } from '../src/testing';
import { seedAccount } from './support/accounts';

const { db, client } = useTestDatabase();
const T0 = new Date('2026-10-16T08:00:00Z');
const NOW = new Date('2026-10-16T09:00:00Z');
/** HMAC-SHA-256 of Rūta's email under the test key (R-94). */
const RUTA_HASH =
  '35ce2f43ee9848c6b83aaa75f6a4297adba1a0b738502cf5622809e5ade2f231';

/**
 * Every column of every audit row but the serial id, so a test sees any
 * column that would hold the address (R-88).
 */
const audit = async (): Promise<Record<string, unknown>[]> =>
  (
    await client.query<Record<string, unknown>>(
      'select * from admin_audit order by id',
    )
  ).rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id')),
  );

/** One full audit row about Rūta's account. */
const rutaRow = (action: string, actor: string): Record<string, unknown> => ({
  action,
  target_account_id: 'a1',
  target_email_hash: RUTA_HASH,
  actor,
  at: NOW,
});

/** The audit rows hold the target's id and hash, never its address. */
const expectNoPlainEmail = async (): Promise<void> => {
  expect(JSON.stringify(await audit())).not.toMatch(/ruta|example/);
};

describe('the audit row (R-88, R-94)', () => {
  it('stores the keyed hash an operator recomputes with auditEmailHash', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await grantAdmin(db, {
      email: 'ruta@example.lt',
      actor: 'cli',
      now: NOW,
      key: TEST_AUDIT_EMAIL_KEY,
    });
    const rows = await audit();
    expect(rows.map((row) => row['target_email_hash'])).toEqual([
      auditEmailHash('ruta@example.lt', TEST_AUDIT_EMAIL_KEY),
    ]);
    await expectNoPlainEmail();
  });
});

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
    expect(
      await grantAdmin(db, {
        email: 'ruta@example.lt',
        actor: 'cli',
        now: NOW,
        key: TEST_AUDIT_EMAIL_KEY,
      }),
    ).toEqual({
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
    expect(await audit()).toEqual([rutaRow('grant-admin', 'cli')]);
    await expectNoPlainEmail();
  });

  it('refuses an unknown email and writes nothing', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    expect(
      await grantAdmin(db, {
        email: 'nobody@example.lt',
        actor: 'cli',
        now: NOW,
        key: TEST_AUDIT_EMAIL_KEY,
      }),
    ).toEqual({
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
    expect(
      await disableAccount(db, {
        email: 'ruta@example.lt',
        actor: 'ops',
        now: NOW,
        key: TEST_AUDIT_EMAIL_KEY,
      }),
    ).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await findAccountById(db, 'a1')).toMatchObject({ disabledAt: NOW });
    expect(await accountFlags()).toEqual([
      { id: 'a1', admin: false, disabled_at: NOW, updated_at: NOW },
      { id: 'a2', admin: false, disabled_at: null, updated_at: T0 },
    ]);
    expect(await sessionOwners()).toEqual([{ account_id: 'a2' }]);
    expect(await audit()).toEqual([rutaRow('disable-account', 'ops')]);
    await expectNoPlainEmail();
  });

  it('refuses an account that is already disabled, changes nothing and writes no audit row', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await client.query(
      `update accounts set disabled_at = $1, updated_at = $1 where id = 'a1'`,
      [T0],
    );
    expect(
      await disableAccount(db, {
        email: 'ruta@example.lt',
        actor: 'ops',
        now: NOW,
        key: TEST_AUDIT_EMAIL_KEY,
      }),
    ).toEqual({
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
    expect(
      await disableAccount(db, {
        email: 'nobody@example.lt',
        actor: 'cli',
        now: NOW,
        key: TEST_AUDIT_EMAIL_KEY,
      }),
    ).toEqual({
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
