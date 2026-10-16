'use server';

import { deleteAccount, updateProfile } from '@mychess/db';
import { canDelete, type AccountRefusal } from '@mychess/domain';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { getMailer } from '../../server/auth';
import { getDb } from '../../server/db';
import { rememberLocale } from '../../server/locale-cookie';
import { deletedMail } from '../../server/mail';
import {
  parseProfileInput,
  type ProfileRefusalKey,
} from '../../server/profile-input';
import { requireAccount, requireOnboarded } from '../../server/session';
import { signOutHere } from '../../server/sign-out';

/** What the profile form shows after a submit. */
export interface ProfileState {
  readonly refusal?: ProfileRefusalKey;
  readonly saved?: boolean;
}

/**
 * Saves a new display name and language. A changed language is also kept in
 * the locale cookie, so the site stays in it after sign-out; the page is
 * refreshed so it shows in the language just chosen.
 */
export async function updateProfileAction(
  _previous: ProfileState,
  form: FormData,
): Promise<ProfileState> {
  const account = await requireOnboarded();
  const profile = parseProfileInput(form);
  if (!profile.ok) return { refusal: profile.refusal.reason };
  await updateProfile(getDb(), account.id, profile.value, new Date());
  if (profile.value.locale !== account.locale)
    await rememberLocale(profile.value.locale);
  refresh();
  return { saved: true };
}

/** What the delete section shows after a refused submit. */
export interface DeleteState {
  readonly refusal?: AccountRefusal['reason'];
}

// The account is already gone, so a failed confirmation mail must not undo
// the redirect; the log names no address (no personal data in logs).
async function mailDeleted(message: ReturnType<typeof deletedMail>) {
  try {
    await getMailer().send(message);
  } catch (error) {
    console.error('account deletion: confirmation mail not sent', error);
  }
}

/**
 * Deletes the account for good once its display name is typed (R-40, R-82),
 * mails the confirmation in its language, and signs this browser out: the
 * session row went with the account, the cookie goes here.
 */
export async function deleteAccountAction(
  _previous: DeleteState,
  form: FormData,
): Promise<DeleteState> {
  const account = await requireAccount();
  const typed = form.get('typedName');
  const check = canDelete(account, typeof typed === 'string' ? typed : '');
  if (!check.ok) return { refusal: check.refusal.reason };
  await deleteAccount(getDb(), account.id);
  await mailDeleted(deletedMail(account.locale, account.email));
  await signOutHere();
  redirect('/prisijungti?deleted=1');
}
