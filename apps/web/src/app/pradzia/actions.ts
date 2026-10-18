'use server';

import { completeOnboarding } from '@mychess/db';
import { isOnboarded } from '@mychess/domain';
import { redirect } from 'next/navigation';
import { returnPath } from '../../lib/return-path';
import { ROUTES } from '../../lib/routes';
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
 * Saves the name and language from onboarding (R-81), then goes home, or
 * on to the invite in the form's `next`. An account that has been through
 * onboarding already goes there untouched: settings is where its name and
 * language change. `next` is client input, so it is checked again here.
 */
export async function completeOnboardingAction(
  _previous: OnboardingState,
  form: FormData,
): Promise<OnboardingState> {
  const account = await requireAccount();
  const next = returnPath(form.get('next'));
  if (isOnboarded(account)) redirect(next ?? ROUTES.home);
  const profile = parseProfileInput(form);
  if (!profile.ok) return { refusal: profile.refusal.reason };
  await completeOnboarding(getDb(), account.id, profile.value, new Date());
  await rememberLocale(profile.value.locale);
  redirect(next ?? ROUTES.home);
}
