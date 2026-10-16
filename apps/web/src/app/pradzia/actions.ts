'use server';

import { completeOnboarding } from '@mychess/db';
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

/** Saves the name and language from onboarding (R-81), then goes home. */
export async function completeOnboardingAction(
  _previous: OnboardingState,
  form: FormData,
): Promise<OnboardingState> {
  const account = await requireAccount();
  const profile = parseProfileInput(form);
  if (!profile.ok) return { refusal: profile.refusal.reason };
  await completeOnboarding(getDb(), account.id, profile.value, new Date());
  await rememberLocale(profile.value.locale);
  redirect('/');
}
