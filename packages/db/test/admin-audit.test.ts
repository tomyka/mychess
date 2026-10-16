import { describe, expect, it } from 'vitest';
import {
  auditEmailHash,
  deleteAccount,
  findAccountById,
  grantAdmin,
} from '../src';
import { TEST_AUDIT_EMAIL_KEY, useTestDatabase } from '../src/testing';
import { seedAccount } from './support/accounts';

const { db, client } = useTestDatabase();
const NOW = new Date('2026-10-16T09:00:00Z');
const RUTA_HASH = auditEmailHash('ruta@example.lt', TEST_AUDIT_EMAIL_KEY);

const insertAudit = () =>
  client.query(
    `insert into admin_audit (action, target_account_id, target_email_hash, actor, at)
     values ('grant-admin', 'a1', $1, 'cli:ruta', now())`,
    [RUTA_HASH],
  );

const auditRows = async (): Promise<unknown> =>
  (
    await client.query(
      'select action, target_account_id, target_email_hash, actor from admin_audit order by id',
    )
  ).rows;

const ROW = {
  action: 'grant-admin',
  target_account_id: 'a1',
  target_email_hash: RUTA_HASH,
  actor: 'cli:ruta',
};

// The audit trail of Admin changes is append-only in the database itself,
// so not even a direct SQL session can rewrite or erase it.
describe('admin_audit is append-only', () => {
  it('takes a new row', async () => {
    await insertAudit();
    expect(await auditRows()).toEqual([ROW]);
  });

  it('refuses an update and keeps the row as it was', async () => {
    await insertAudit();
    await expect(
      client.query(`update admin_audit set actor = 'someone-else'`),
    ).rejects.toThrow(/admin_audit is append-only/);
    expect(await auditRows()).toEqual([ROW]);
  });

  it('refuses a delete and keeps the row', async () => {
    await insertAudit();
    await expect(client.query('delete from admin_audit')).rejects.toThrow(
      /admin_audit is append-only/,
    );
    expect(await auditRows()).toEqual([ROW]);
  });

  it('does not stop an audited account from being deleted', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await grantAdmin(db, {
      email: 'ruta@example.lt',
      actor: 'cli:ruta',
      now: NOW,
      key: TEST_AUDIT_EMAIL_KEY,
    });
    await deleteAccount(db, 'a1');
    expect(await findAccountById(db, 'a1')).toBeUndefined();
    expect(await auditRows()).toEqual([ROW]);
  });

  // The next two tests run in order (the root config never shuffles): the
  // first leaves a row behind, the second sees the test helper's truncate
  // empty it despite the trigger.
  it('leaves a row for the next test', async () => {
    await insertAudit();
    expect(await auditRows()).toEqual([ROW]);
  });

  it('is still emptied between tests by the test helper', async () => {
    expect(await auditRows()).toEqual([]);
  });
});
