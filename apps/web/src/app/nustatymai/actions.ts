'use server';

import { deleteConfirmedAccount, updateProfile } from '@mychess/db';
import type { AccountRefusal } from '@mychess/domain';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ROUTES } from '../../lib/routes';
import { getMailer } from '../../server/auth';
import { getDb } from '../../server/db';
import { forgetLichessUnlinked } from '../../server/lichess-unlinked';
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
// the redirect. The log keeps only the error's kind: a transport's error
// object or message can carry the address (no personal data in logs).
async function mailDeleted(message: ReturnType<typeof deletedMail>) {
  try {
    await getMailer().send(message);
  } catch (error) {
    console.error(
      'account deletion: confirmation mail not sent',
      error instanceof Error ? error.name : typeof error,
    );
  }
}

/**
 * Deletes the account for good once it is confirmed (R-40, R-82): by its
 * display name, or by its email before onboarding (R-86). The domain
 * decides on the locked row, as it is deleted: whether the typed text
 * confirms, and whether the confirmation mail goes, in its language and
 * only to a proven address (R-87). Then signs this browser out: the
 * session row went with the account, the cookie goes here.
 */
export async function deleteAccountAction(
  _previous: DeleteState,
  form: FormData,
): Promise<DeleteState> {
  const account = await requireAccount();
  const typed = form.get('confirmation');
  const deletion = await deleteConfirmedAccount(getDb(), {
    id: account.id,
    typed: typeof typed === 'string' ? typed : '',
    now: new Date(),
  });
  if (!deletion.ok) return { refusal: deletion.refusal.reason };
  const mail = deletion.value.confirmationMail;
  if (mail !== null) await mailDeleted(deletedMail(mail.locale, mail.to));
  await signOutHere();
  redirect(`${ROUTES.signIn}?deleted=1`);
}

/** Dismisses the note that Lichess was disconnected for security (R-90). */
export async function dismissLichessUnlinkedAction(): Promise<void> {
  await requireAccount();
  await forgetLichessUnlinked();
  refresh();
}
