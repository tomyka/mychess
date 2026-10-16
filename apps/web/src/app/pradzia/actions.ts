'use server';

import { completeOnboarding } from '@mychess/db';
import { isOnboarded } from '@mychess/domain';
import { redirect } from 'next/navigation';
import { getDb } from '../../server/db';
import { rememberLocale } from '../../server/locale-cookie';
import {
  parseProfileInput,
  type ProfileRefusalKey,
} from '../../server/profile-input';
import { requireAccount } from '../../server/session';

/** What the onboarding form shows after a submit that did not go home. */
export interface OnboardingState {
  readonly refusal?: ProfileRefusalKey;
}

/**
 * Saves the name and language from onboarding (R-81), then goes home. An
 * account that has been through onboarding already goes home untouched:
 * settings is where its name and language change.
 */
export async function completeOnboardingAction(
  _previous: OnboardingState,
  form: FormData,
): Promise<OnboardingState> {
  const account = await requireAccount();
  if (isOnboarded(account)) redirect('/');
  const profile = parseProfileInput(form);
  if (!profile.ok) return { refusal: profile.refusal.reason };
  await completeOnboarding(getDb(), account.id, profile.value, new Date());
  await rememberLocale(profile.value.locale);
  redirect('/');
}
