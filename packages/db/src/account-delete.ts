/**
 * Hard delete of an account (R-40, R-82). Kept apart from accounts.ts: the
 * R-49 auto-fork reaches the assignments module, which locks accounts
 * through accounts.ts.
 */
import { eq, sql, type SQL } from 'drizzle-orm';
import { lockAccountById } from './accounts';
import { forkForDeletingCoach } from './assignments/coach-delete';
import type { Executor } from './client';
import { accounts, verifications } from './schema';

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
 */
export async function deleteAccount(
  db: Executor,
  id: string,
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const account = await lockAccountById(tx, id);
    if (account === undefined) return;
    await forkForDeletingCoach(tx, id, now);
    await tx.delete(verifications).where(namesEmail(account.email));
    await tx.delete(accounts).where(eq(accounts.id, id));
  });
}
