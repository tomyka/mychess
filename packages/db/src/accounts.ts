import { accountSchema, type Account, type Profile } from '@mychess/domain';
import { eq, type SQL } from 'drizzle-orm';
import type { Executor, Tx } from './client';
import { accounts } from './schema';

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
