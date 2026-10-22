/**
 * Hard delete of an account (R-40, R-82). Kept apart from accounts.ts: the
 * R-49 auto-fork reaches the assignments module, which locks accounts
 * through accounts.ts.
 */
import type { Result } from '@mychess/chess';
import {
  decideDeletion,
  type Account,
  type AccountDeletion,
  type AccountRefusal,
} from '@mychess/domain';
import { eq, sql, type SQL } from 'drizzle-orm';
import { lockAccountById } from './accounts';
import { forkForDeletingCoach } from './assignments/coach-delete';
import type { Db, Tx } from './client';
import { retryOnConflict } from './retry-on-conflict';
import { accounts, verifications } from './schema';

/** Runs of the delete transaction before a deadlock or serialization failure is thrown (#286). */
const DELETE_ATTEMPTS = 3;

/**
 * A verification row whose value is a JSON object naming `email`, compared
 * after lowercasing and trimming (the token holds the address as typed).
 * Values that are not valid JSON (OAuth state, plain tokens) never match and
 * never make the query fail.
 */
const namesEmail = (email: string): SQL =>
  sql`case when pg_input_is_valid(${verifications.value}, 'jsonb') then lower(btrim(${verifications.value}::jsonb ->> 'email')) end = ${email}`;

/**
 * Hard delete (R-40, R-82): the account and, by cascade, its sessions and
 * provider links; its pending magic-link tokens are matched by email.
 * S4's coaching rows go by cascade too: a coach's links, groups, group
 * memberships and invites; a player's links and memberships. A personal
 * invite the player used stays with the coach, without the player
 * (`used_by` set null). S3's repertoires go by cascade too, with their
 * chapters, moves, chapter links and personal notes. S4's shares and the
 * coach notes under them go too: a coach's through their links, a player's
 * through their links and repertoires (R-124: a note lives only under its
 * share).
 *
 * S5: first, with the account row locked (the S4 lock order), every player
 * with a live assignment from this account gets an automatic fork (R-49),
 * its coach notes carrying this account's display name. Then the cascade
 * takes the account's assignments, the players' state on them
 * (`assignment_players`) and the repertoires' change rows; the account's
 * own fork offers, forks and fork coach notes go with it as a player. The
 * fork offers it made to others stay, with `repertoire_id` set null: they
 * hold their snapshots. Later slices extend the cascade with the rows they
 * add.
 *
 * A concurrent delete can deadlock with it (a coach's auto-fork against
 * their player's own delete, #286); Postgres rolls the whole transaction
 * back, and it runs again, up to DELETE_ATTEMPTS times. It takes the
 * database, not a transaction: a retry inside a caller's transaction could
 * not recover it.
 */
export async function deleteAccount(
  db: Db,
  id: string,
  now: Date = new Date(),
): Promise<void> {
  await retryOnConflict(
    () =>
      db.transaction(async (tx) => {
        const account = await lockAccountById(tx, id);
        if (account !== undefined) await removeLocked(tx, account, now);
      }),
    DELETE_ATTEMPTS,
  );
}

/** What the person asked: delete account `id`, confirmed by `typed`. */
export interface DeletionRequest {
  readonly id: string;
  readonly typed: string;
  readonly now: Date;
}

/**
 * The person's own delete (R-40): decided by the domain on the locked
 * account row, then, when it confirms, the same hard delete as
 * `deleteAccount`, in the same transaction. The display name confirms it
 * (R-82), or the email for an account not yet onboarded (R-86); the answer
 * says where the confirmation mail goes, only to a proven address (R-87). A
 * refusal deletes nothing.
 *
 * The account row is locked first (the S4 lock order), so an account
 * onboarded since the caller read it is decided as it now stands, and of
 * two confirmations that race the second finds no account: it is answered
 * without a mail. It runs again on a deadlock, as `deleteAccount` (#286).
 */
export function deleteConfirmedAccount(
  db: Db,
  request: DeletionRequest,
): Promise<Result<AccountDeletion, AccountRefusal>> {
  return retryOnConflict(
    () =>
      db.transaction(async (tx) => {
        const account = await lockAccountById(tx, request.id);
        const decision = decideDeletion(account, request.typed);
        if (decision.ok && account !== undefined)
          await removeLocked(tx, account, request.now);
        return decision;
      }),
    DELETE_ATTEMPTS,
  );
}

/** The delete itself, on an account whose row `tx` has locked. */
async function removeLocked(
  tx: Tx,
  account: Account,
  now: Date,
): Promise<void> {
  await forkForDeletingCoach(tx, account.id, now);
  await tx.delete(verifications).where(namesEmail(account.email));
  await tx.delete(accounts).where(eq(accounts.id, account.id));
}
