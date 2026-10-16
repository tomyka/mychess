import { findAccountById } from '@mychess/db';
import { isOnboarded, type Account } from '@mychess/domain';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getAuth } from './auth';
import { getDb } from './db';

/**
 * The signed-in, enabled account of this request, or null (one lookup per
 * request). The request's headers are read first: a page prerendered at
 * build time stops there, before the auth needs any environment.
 */
export const getAccount = cache(async (): Promise<Account | null> => {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session === null) return null;
  const account = await findAccountById(getDb(), session.user.id);
  return account?.disabledAt === null ? account : null;
});

/** Signed-out visitors go to sign-in. */
export async function requireAccount(): Promise<Account> {
  const account = await getAccount();
  if (account === null) redirect('/prisijungti');
  return account;
}

/** Signed-in but not onboarded accounts go to onboarding first (R-81). */
export async function requireOnboarded(): Promise<Account> {
  const account = await requireAccount();
  if (!isOnboarded(account)) redirect('/pradzia');
  return account;
}
