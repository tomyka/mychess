import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n/catalogue';
import { useShortDeadline, useShortInstant } from './use-deadline';

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider
    locale="en"
    messages={MESSAGES}
    timeZone="Europe/Vilnius"
  >
    {children}
  </NextIntlClientProvider>
);

describe('useShortInstant', () => {
  it('writes an instant as its Vilnius day, month short, the year only when not this one', () => {
    const { result } = renderHook(() => useShortInstant('2026-11-27'), {
      wrapper,
    });
    // 22:30 UTC on 3 December is 00:30 on 4 December in Vilnius.
    expect(result.current(new Date('2026-12-03T22:30:00Z'))).toBe('Dec 4');
    expect(result.current(new Date('2027-01-02T09:00:00Z'))).toBe(
      'Jan 2, 2027',
    );
  });
});

describe('useShortDeadline', () => {
  it('writes a calendar day by the same rule', () => {
    const { result } = renderHook(() => useShortDeadline('2026-11-27'), {
      wrapper,
    });
    expect(result.current('2026-11-30')).toBe('Nov 30');
    expect(result.current('2027-01-02')).toBe('Jan 2, 2027');
  });
});
