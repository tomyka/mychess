import { accountSchema, type Account, type Profile } from '@mychess/domain';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { Executor, Tx } from './client';
import { accounts, verifications } from './schema';

/** The Account columns, as accountSchema parses them. */
export const accountColumns = {
  id: accounts.id,
  email: accounts.email,
  emailVerified: accounts.emailVerified,
  displayName: accounts.displayName,
  locale: accounts.locale,
  entitlement: accounts.entitlement,
  admin: accounts.admin,
  disabledAt: accounts.disabledAt,
  onboardedAt: accounts.onboardedAt,
  coachSince: accounts.coachSince,
  createdAt: accounts.createdAt,
};

async function findOne(db: Executor, where: SQL): Promise<Account | undefined> {
  const [row] = await db
    .select(accountColumns)
    .from(accounts)
    .where(where)
    .limit(1);
  return row === undefined ? undefined : accountSchema.parse(row);
}

/**
 * The account, with its row locked against other lockers and updates for
 * the rest of `tx` (FOR NO KEY UPDATE). Every transaction that adds a
 * coach's invite, link or group, or switches Coach mode off, takes this
 * lock on the coach, so counts read after it are final (plan decision 1).
 * It does not block the KEY SHARE locks foreign-key checks take.
 */
export async function lockAccountById(
  tx: Tx,
  id: string,
): Promise<Account | undefined> {
  const [row] = await tx
    .select(accountColumns)
    .from(accounts)
    .where(eq(accounts.id, id))
    .for('no key update');
  return row === undefined ? undefined : accountSchema.parse(row);
}

export function findAccountById(
  db: Executor,
  id: string,
): Promise<Account | undefined> {
  return findOne(db, eq(accounts.id, id));
}

/** `email` must already be canonical (domain canonicalEmail). */
export function findAccountByEmail(
  db: Executor,
  email: string,
): Promise<Account | undefined> {
  return findOne(db, eq(accounts.email, email));
}

/** The profile write both onboarding and settings make. */
interface ProfileChange extends Profile {
  readonly updatedAt: Date;
  readonly onboardedAt?: Date;
}

async function setProfile(
  db: Executor,
  id: string,
  change: ProfileChange,
): Promise<void> {
  await db.update(accounts).set(change).where(eq(accounts.id, id));
}

export function updateProfile(
  db: Executor,
  id: string,
  profile: Profile,
  now: Date,
): Promise<void> {
  return setProfile(db, id, { ...profile, updatedAt: now });
}

export function completeOnboarding(
  db: Executor,
  id: string,
  profile: Profile,
  now: Date,
): Promise<void> {
  return setProfile(db, id, { ...profile, onboardedAt: now, updatedAt: now });
}

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
 * (`used_by` set null). Later slices extend the cascade with the rows
 * they add.
 */
export async function deleteAccount(db: Executor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const account = await findAccountById(tx, id);
    if (account === undefined) return;
    await tx.delete(verifications).where(namesEmail(account.email));
    await tx.delete(accounts).where(eq(accounts.id, id));
  });
}
