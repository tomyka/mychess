'use server';

import { completeOnboarding } from '@mychess/db';
import { accountStage } from '@mychess/domain';
import { redirect } from 'next/navigation';
import { onboardingRefusalPath } from '../../lib/onboarding-redirect';
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
 * The domain decides again on the locked row: a submit that lost a race
 * goes on without writing, and an account closed meanwhile goes to
 * sign-in (R-80); neither remembers the locale.
 */
export async function completeOnboardingAction(
  _previous: OnboardingState,
  form: FormData,
): Promise<OnboardingState> {
  const account = await requireAccount();
  const next = returnPath(form.get('next'));
  if (accountStage(account) === 'onboarded') redirect(next ?? ROUTES.home);
  const profile = parseProfileInput(form);
  if (!profile.ok) return { refusal: profile.refusal.reason };
  const done = await completeOnboarding(
    getDb(),
    account.id,
    profile.value,
    new Date(),
  );
  if (!done.ok) redirect(onboardingRefusalPath(done.refusal, next));
  await rememberLocale(profile.value.locale);
  redirect(next ?? ROUTES.home);
}
