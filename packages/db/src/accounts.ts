import { ok, type Result } from '@mychess/chess';
import {
  accountSchema,
  decideOnboarding,
  type Account,
  type OnboardingRefusal,
  type Profile,
} from '@mychess/domain';
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
export function lockAccountById(
  tx: Tx,
  id: string,
): Promise<Account | undefined> {
  return lockOne(tx, eq(accounts.id, id));
}

/**
 * The account with this email, its row locked as `lockAccountById` locks it.
 * `email` must already be canonical (domain canonicalEmail).
 */
export function lockAccountByEmail(
  tx: Tx,
  email: string,
): Promise<Account | undefined> {
  return lockOne(tx, eq(accounts.email, email));
}

async function lockOne(tx: Tx, where: SQL): Promise<Account | undefined> {
  const [row] = await tx
    .select(accountColumns)
    .from(accounts)
    .where(where)
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

/**
 * Onboarding happens once (R-81), decided on the locked account row: of two
 * submits that race, one writes and the other is refused
 * `lifecycle.alreadyOnboarded`; a disabled or deleted account is refused
 * `lifecycle.accountClosed` (R-80). A refusal writes nothing. On a `Tx` the
 * transaction is a savepoint.
 */
export function completeOnboarding(
  db: Executor,
  id: string,
  profile: Profile,
  now: Date,
): Promise<Result<undefined, OnboardingRefusal>> {
  return db.transaction(async (tx) => {
    const decision = decideOnboarding(
      await lockAccountById(tx, id),
      profile,
      now,
    );
    if (!decision.ok) return decision;
    await setProfile(tx, id, {
      ...decision.value.profile,
      onboardedAt: decision.value.onboardedAt,
      updatedAt: now,
    });
    return ok();
  });
}
