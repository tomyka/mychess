import { ok, refuse, type Result } from '@mychess/chess';
import {
  ADMIN_REFUSALS,
  decideDisable,
  type Account,
  type AdminAction,
  type AdminRefusal,
} from '@mychess/domain';
import { eq } from 'drizzle-orm';
import { lockAccountByEmail } from './accounts';
import { auditEmailHash } from './audit-email';
import type { Db, Tx } from './client';
import { accounts, adminAudit, sessions } from './schema';

type AdminResult = Result<undefined, AdminRefusal>;

/** What the CLI passes an Admin change: whom, by whom, when, and the hash key. */
export interface AdminInput {
  /** Canonical email of the target account. */
  readonly email: string;
  readonly actor: string;
  readonly now: Date;
  /** The environment's AUDIT_EMAIL_KEY the audit row's email hash is keyed with (R-94). */
  readonly key: string;
}

/** One audit row's facts, minus the target id the lookup finds. */
interface AuditEntry extends AdminInput {
  readonly action: AdminAction;
}

/**
 * An Admin change: the domain decision on the locked target, which may
 * refuse it, then the write of what it decided.
 */
interface AdminChange<T> {
  readonly check: (account: Account) => Result<T, AdminRefusal>;
  readonly apply: (tx: Tx, id: string, decided: T) => Promise<void>;
}

const allowed = (): AdminResult => ok();

/**
 * Runs one Admin change and its audit row in a single transaction
 * (security item 8); a refused change writes nothing. The target's row is
 * locked before the change is decided, so two runs on one account decide
 * one after the other (#267). `entry.email` must be canonical.
 */
async function audited<T>(
  db: Db,
  entry: AuditEntry,
  change: AdminChange<T>,
): Promise<AdminResult> {
  return db.transaction(async (tx) => {
    const account = await lockAccountByEmail(tx, entry.email);
    if (account === undefined) return refuse(ADMIN_REFUSALS.accountNotFound);
    const checked = change.check(account);
    if (!checked.ok) return checked;
    await change.apply(tx, account.id, checked.value);
    await tx.insert(adminAudit).values({
      action: entry.action,
      targetAccountId: account.id,
      targetEmailHash: auditEmailHash(entry.email, entry.key),
      actor: entry.actor,
      at: entry.now,
    });
    return ok();
  });
}

/** Makes an account an Admin (R-72); only the CLI calls this. */
export function grantAdmin(db: Db, input: AdminInput): Promise<AdminResult> {
  return audited(
    db,
    { ...input, action: 'grant-admin' },
    {
      check: allowed,
      apply: async (tx, id) => {
        await tx
          .update(accounts)
          .set({ admin: true, updatedAt: input.now })
          .where(eq(accounts.id, id));
      },
    },
  );
}

/**
 * Disables an account and ends every session it has, at once (R-80);
 * refuses an account that is already disabled. Decided on the locked row:
 * of two runs that race, one disables and audits, the other is refused.
 */
export function disableAccount(
  db: Db,
  input: AdminInput,
): Promise<AdminResult> {
  return audited(
    db,
    { ...input, action: 'disable-account' },
    {
      check: (account) => decideDisable(account, input.now),
      apply: async (tx, id, { disabledAt }) => {
        await tx
          .update(accounts)
          .set({ disabledAt, updatedAt: input.now })
          .where(eq(accounts.id, id));
        await tx.delete(sessions).where(eq(sessions.accountId, id));
      },
    },
  );
}
