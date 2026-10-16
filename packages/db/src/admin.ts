import type { Result } from '@mychess/chess';
import { eq } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { accounts, adminAudit, sessions } from './schema';

export interface AdminRefusal {
  reason: 'admin.accountNotFound';
}

/** One audit row's facts, minus the target id the lookup finds. */
interface AuditEntry {
  readonly action: (typeof adminAudit.$inferInsert)['action'];
  /** Canonical email of the target account. */
  readonly email: string;
  readonly actor: string;
  readonly now: Date;
}

/**
 * Runs one Admin change and its audit row in a single transaction
 * (security item 8). `entry.email` must be canonical.
 */
async function audited(
  db: Db,
  entry: AuditEntry,
  change: (tx: Tx, id: string) => Promise<void>,
): Promise<Result<undefined, AdminRefusal>> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, entry.email))
      .limit(1);
    if (row === undefined) {
      return { ok: false, refusal: { reason: 'admin.accountNotFound' } };
    }
    await change(tx, row.id);
    await tx.insert(adminAudit).values({
      action: entry.action,
      targetAccountId: row.id,
      targetEmail: entry.email,
      actor: entry.actor,
      at: entry.now,
    });
    return { ok: true, value: undefined };
  });
}

/** Makes an account an Admin (R-72); only the CLI calls this. */
export function grantAdmin(
  db: Db,
  email: string,
  actor: string,
  now: Date,
): Promise<Result<undefined, AdminRefusal>> {
  const entry = { action: 'grant-admin', email, actor, now } as const;
  return audited(db, entry, async (tx, id) => {
    await tx
      .update(accounts)
      .set({ admin: true, updatedAt: now })
      .where(eq(accounts.id, id));
  });
}

/** Disables an account and ends every session it has, at once (R-80). */
export function disableAccount(
  db: Db,
  email: string,
  actor: string,
  now: Date,
): Promise<Result<undefined, AdminRefusal>> {
  const entry = { action: 'disable-account', email, actor, now } as const;
  return audited(db, entry, async (tx, id) => {
    await tx
      .update(accounts)
      .set({ disabledAt: now, updatedAt: now })
      .where(eq(accounts.id, id));
    await tx.delete(sessions).where(eq(sessions.accountId, id));
  });
}
