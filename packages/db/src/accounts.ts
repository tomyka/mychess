import {
  accountSchema,
  type Account,
  type Entitlement,
  type Locale,
  type Profile,
} from '@mychess/domain';
import { eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
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
    readonly image: string | null;
    readonly entitlement: Entitlement;
    /** ISO time, or null before onboarding. */
    readonly onboardedAt: string | null;
    readonly createdAt: string;
  };
  readonly linkedProviders: readonly {
    readonly provider: string;
    readonly linkedAt: string;
  }[];
}

const exportRowSchema = accountSchema.extend({
  image: z.string().nullable(),
});

const linkRowsSchema = z.array(
  z.object({ provider: z.string().min(1), linkedAt: z.date() }),
);

/** The requester's own data (R-40, security item 9); never tokens. */
export async function exportAccount(
  db: Executor,
  id: string,
): Promise<AccountExport | undefined> {
  const [row] = await db
    .select({ ...columns, image: accounts.image })
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  if (row === undefined) return undefined;
  const account = exportRowSchema.parse(row);
  const links = linkRowsSchema.parse(
    await db
      .select({
        provider: providerAccounts.providerId,
        linkedAt: providerAccounts.createdAt,
      })
      .from(providerAccounts)
      .where(eq(providerAccounts.accountId, id))
      .orderBy(providerAccounts.createdAt, providerAccounts.id),
  );
  return {
    account: {
      email: account.email,
      displayName: account.displayName,
      locale: account.locale,
      image: account.image,
      entitlement: account.entitlement,
      onboardedAt: account.onboardedAt?.toISOString() ?? null,
      createdAt: account.createdAt.toISOString(),
    },
    linkedProviders: links.map((link) => ({
      provider: link.provider,
      linkedAt: link.linkedAt.toISOString(),
    })),
  };
}
