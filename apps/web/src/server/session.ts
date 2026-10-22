import { findAccountById } from '@mychess/db';
import { accountStage, isFreshSession, type Account } from '@mychess/domain';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { ROUTES } from '../lib/routes';
import { getAuth } from './auth';
import { getDb } from './db';

/**
 * This request's session, or null (one lookup per request). The request's
 * headers are read first: a page prerendered at build time stops there,
 * before the auth needs any environment.
 */
const getSession = cache(async () => {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

/**
 * The signed-in, enabled account of this request, or null: a disabled
 * account reads as signed out (R-80).
 */
export const getAccount = cache(async (): Promise<Account | null> => {
  const session = await getSession();
  if (session === null) return null;
  const account = await findAccountById(getDb(), session.user.id);
  return account === undefined || accountStage(account) === 'disabled'
    ? null
    : account;
});

/** Signed-out visitors go to sign-in. */
export async function requireAccount(): Promise<Account> {
  const account = await getAccount();
  if (account === null) redirect(ROUTES.signIn);
  return account;
}

/** Signed-in but not onboarded accounts go to onboarding first (R-81). */
export async function requireOnboarded(): Promise<Account> {
  const account = await requireAccount();
  if (accountStage(account) !== 'onboarded') redirect(ROUTES.onboarding);
  return account;
}

/**
 * Did this request's session start within the last day? Downloading the
 * data export needs that, as linking a provider does (R-84, R-95).
 */
export async function hasFreshSession(): Promise<boolean> {
  const session = await getSession();
  return (
    session !== null &&
    isFreshSession(new Date(session.session.createdAt), new Date())
  );
}
