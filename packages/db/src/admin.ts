import type { Result } from '@mychess/chess';
import {
  ADMIN_REFUSALS,
  canDisable,
  type Account,
  type AdminAction,
  type AdminRefusal,
} from '@mychess/domain';
import { eq } from 'drizzle-orm';
import { findAccountByEmail } from './accounts';
import type { Db, Tx } from './client';
import { accounts, adminAudit, sessions } from './schema';

type AdminResult = Result<undefined, AdminRefusal>;

/** One audit row's facts, minus the target id the lookup finds. */
interface AuditEntry {
  readonly action: AdminAction;
  /** Canonical email of the target account. */
  readonly email: string;
  readonly actor: string;
  readonly now: Date;
}

/** An Admin change: the domain check that may refuse it, then the write. */
interface AdminChange {
  readonly check: (account: Account) => AdminResult;
  readonly apply: (tx: Tx, id: string) => Promise<void>;
}

const allowed = (): AdminResult => ({ ok: true, value: undefined });

/**
 * Runs one Admin change and its audit row in a single transaction
 * (security item 8); a refused change writes nothing. `entry.email` must be
 * canonical.
 */
async function audited(
  db: Db,
  entry: AuditEntry,
  change: AdminChange,
): Promise<AdminResult> {
  return db.transaction(async (tx) => {
    const account = await findAccountByEmail(tx, entry.email);
    if (account === undefined) {
      return { ok: false, refusal: { reason: ADMIN_REFUSALS.accountNotFound } };
    }
    const checked = change.check(account);
    if (!checked.ok) return checked;
    await change.apply(tx, account.id);
    await tx.insert(adminAudit).values({
      action: entry.action,
      targetAccountId: account.id,
      targetEmail: entry.email,
      actor: entry.actor,
      at: entry.now,
    });
    return checked;
  });
}

/** Makes an account an Admin (R-72); only the CLI calls this. */
export function grantAdmin(
  db: Db,
  email: string,
  actor: string,
  now: Date,
): Promise<AdminResult> {
  const entry = { action: 'grant-admin', email, actor, now } as const;
  return audited(db, entry, {
    check: allowed,
    apply: async (tx, id) => {
      await tx
        .update(accounts)
        .set({ admin: true, updatedAt: now })
        .where(eq(accounts.id, id));
    },
  });
}

/**
 * Disables an account and ends every session it has, at once (R-80);
 * refuses an account that is already disabled.
 */
export function disableAccount(
  db: Db,
  email: string,
  actor: string,
  now: Date,
): Promise<AdminResult> {
  const entry = { action: 'disable-account', email, actor, now } as const;
  return audited(db, entry, {
    check: canDisable,
    apply: async (tx, id) => {
      await tx
        .update(accounts)
        .set({ disabledAt: now, updatedAt: now })
        .where(eq(accounts.id, id));
      await tx.delete(sessions).where(eq(sessions.accountId, id));
    },
  });
}
