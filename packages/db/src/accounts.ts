import { accountSchema, type Account, type Locale } from '@mychess/domain';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { Executor } from './client';
import { accounts, providerAccounts, verifications } from './schema';

const columns = {
  id: accounts.id,
  email: accounts.email,
  displayName: accounts.displayName,
  locale: accounts.locale,
  entitlement: accounts.entitlement,
  admin: accounts.admin,
  disabledAt: accounts.disabledAt,
  onboardedAt: accounts.onboardedAt,
  createdAt: accounts.createdAt,
};

async function findOne(db: Executor, where: SQL): Promise<Account | undefined> {
  const [row] = await db.select(columns).from(accounts).where(where).limit(1);
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

export interface Profile {
  readonly displayName: string;
  readonly locale: Locale;
}

export async function updateProfile(
  db: Executor,
  id: string,
  profile: Profile,
  now: Date,
): Promise<void> {
  await db
    .update(accounts)
    .set({ ...profile, updatedAt: now })
    .where(eq(accounts.id, id));
}

export async function completeOnboarding(
  db: Executor,
  id: string,
  profile: Profile,
  now: Date,
): Promise<void> {
  await db
    .update(accounts)
    .set({ ...profile, onboardedAt: now, updatedAt: now })
    .where(eq(accounts.id, id));
}

/**
 * A verification row whose value is a JSON object naming `email`. Values
 * that are not valid JSON (OAuth state, plain tokens) never match and never
 * make the query fail.
 */
const namesEmail = (email: string): SQL =>
  sql`case when pg_input_is_valid(${verifications.value}, 'jsonb') then ${verifications.value}::jsonb ->> 'email' end = ${email}`;

/**
 * Hard delete (R-40, R-82): the account and, by cascade, its sessions and
 * provider links; its pending magic-link tokens are matched by email.
 * Later slices extend the cascade with the rows they add.
 */
export async function deleteAccount(db: Executor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const account = await findAccountById(tx, id);
    if (account === undefined) return;
    await tx.delete(verifications).where(namesEmail(account.email));
    await tx.delete(accounts).where(eq(accounts.id, id));
  });
}

export interface AccountExport {
  readonly account: {
    readonly email: string;
    readonly displayName: string;
    readonly locale: Locale;
    readonly entitlement: string;
    readonly createdAt: string;
  };
  readonly linkedProviders: readonly {
    readonly provider: string;
    readonly linkedAt: string;
  }[];
}

/** The requester's own data (R-40, security item 9); never tokens. */
export async function exportAccount(
  db: Executor,
  id: string,
): Promise<AccountExport | undefined> {
  const account = await findAccountById(db, id);
  if (account === undefined) return undefined;
  const links = await db
    .select({
      provider: providerAccounts.providerId,
      linkedAt: providerAccounts.createdAt,
    })
    .from(providerAccounts)
    .where(eq(providerAccounts.accountId, id))
    .orderBy(providerAccounts.createdAt, providerAccounts.id);
  return {
    account: {
      email: account.email,
      displayName: account.displayName,
      locale: account.locale,
      entitlement: account.entitlement,
      createdAt: account.createdAt.toISOString(),
    },
    linkedProviders: links.map((link) => ({
      provider: link.provider,
      linkedAt: link.linkedAt.toISOString(),
    })),
  };
}
