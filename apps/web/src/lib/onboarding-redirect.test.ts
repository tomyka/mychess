import { describe, expect, it } from 'vitest';
import { onboardingRefusalPath } from './onboarding-redirect';

const INVITE = `/k/${'A'.repeat(42)}_`;

describe('onboardingRefusalPath', () => {
  it('sends an onboarded account on to the invite in next', () => {
    expect(
      onboardingRefusalPath({ reason: 'lifecycle.alreadyOnboarded' }, INVITE),
    ).toBe(INVITE);
  });

  it('sends an onboarded account home without a next', () => {
    expect(
      onboardingRefusalPath({ reason: 'lifecycle.alreadyOnboarded' }, null),
    ).toBe('/');
  });

  it.each([INVITE, null])(
    'sends a closed account to sign-in whatever next is (%s)',
    (next) => {
      expect(
        onboardingRefusalPath({ reason: 'lifecycle.accountClosed' }, next),
      ).toBe('/prisijungti');
    },
  );
});
