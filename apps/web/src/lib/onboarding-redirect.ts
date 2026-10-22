import type {
  LifecycleRefusalReason,
  OnboardingRefusal,
} from '@mychess/domain';
import { ROUTES } from './routes';

// One path per refusal reason, so a new reason fails typecheck here.
const PATHS: Record<LifecycleRefusalReason, (next: string | null) => string> = {
  'lifecycle.alreadyOnboarded': (next) => next ?? ROUTES.home,
  'lifecycle.accountClosed': () => ROUTES.signIn,
};

/**
 * Where an onboarding submit the domain refused goes (R-80, R-81): an
 * account already onboarded goes home, or on to the invite in `next`; a
 * closed one (gone or disabled) goes to sign-in. `next` must already be a
 * checked return path.
 */
export function onboardingRefusalPath(
  refusal: OnboardingRefusal,
  next: string | null,
): string {
  return PATHS[refusal.reason](next);
}
