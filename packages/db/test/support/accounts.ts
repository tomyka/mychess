import type { Db } from '../../src';
import {
  accounts,
  providerAccounts,
  sessions,
  verifications,
} from '../../src/schema';

const T0 = new Date('2026-10-16T08:00:00Z');

/** One account with a session, a Lichess link and a pending magic link. */
export async function seedAccount(
  db: Db,
  id: string,
  email: string,
): Promise<void> {
  await db.insert(accounts).values({
    id,
    email,
    emailVerified: true,
    displayName: id,
    createdAt: T0,
    updatedAt: T0,
  });
  await db.insert(sessions).values({
    id: `s-${id}`,
    token: `t-${id}`,
    accountId: id,
    expiresAt: new Date('2027-01-14T08:00:00Z'),
    createdAt: T0,
    updatedAt: T0,
  });
  await db.insert(providerAccounts).values({
    id: `p-${id}`,
    providerAccountId: `lichess-${id}`,
    providerId: 'lichess',
    accountId: id,
    accessToken: 'encrypted',
    createdAt: T0,
    updatedAt: T0,
  });
  await seedVerification(db, `v-${id}`, JSON.stringify({ email }));
}

/** A verification row with any `value`, JSON or not. */
export async function seedVerification(
  db: Db,
  id: string,
  value: string,
): Promise<void> {
  await db.insert(verifications).values({
    id,
    identifier: `token-${id}`,
    value,
    expiresAt: new Date('2026-10-16T08:15:00Z'),
    createdAt: T0,
    updatedAt: T0,
  });
}
