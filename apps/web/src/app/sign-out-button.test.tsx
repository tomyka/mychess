import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/locales';
import { SignOutButton } from './sign-out-button';

const calls = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    push: (to: string) => {
      order.push(`push ${to}`);
    },
    signOut: () => {
      order.push('signOut');
      return Promise.resolve({ data: { success: true }, error: null });
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: calls.push }),
}));

vi.mock('../lib/auth-client', () => ({
  authClient: { signOut: calls.signOut },
}));

describe('SignOutButton', () => {
  it('signs out, then goes to sign-in', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
        <SignOutButton />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => {
      expect(calls.order).toEqual(['signOut', 'push /prisijungti']);
    });
  });
});
