import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/locales';
import { SignOutButton } from './sign-out-button';
import { queueKey } from './treniruote/result-queue';

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

const RESULT = {
  resultId: '00000000-0000-4000-8000-000000000001',
  kind: 'pass',
  moveKey: 'k1|d4',
  repertoireId: '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10',
  answeredAt: '2026-10-20T08:00:00.000Z',
};

const signOutWith = (accountId: string) => {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
      <SignOutButton accountId={accountId} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
};

beforeEach(() => {
  calls.order.length = 0;
  window.localStorage.clear();
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    calls.order.push(`post ${typeof init.body === 'string' ? init.body : ''}`);
    return Promise.resolve(
      Response.json({
        answers: [{ resultId: RESULT.resultId, status: 'applied' }],
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  return () => {
    vi.unstubAllGlobals();
  };
});

describe('SignOutButton', () => {
  it('signs out, then goes to sign-in', async () => {
    signOutWith('rokas');
    await waitFor(() => {
      expect(calls.order).toEqual(['signOut', 'push /prisijungti']);
    });
  });

  it("sends the account's queued results first, then removes every queue from this browser", async () => {
    window.localStorage.setItem(queueKey('rokas'), JSON.stringify([RESULT]));
    window.localStorage.setItem(queueKey('gabija'), JSON.stringify([RESULT]));
    window.localStorage.setItem('theme', 'dark');
    signOutWith('rokas');
    await waitFor(() => {
      expect(calls.order).toEqual([
        `post ${JSON.stringify([RESULT])}`,
        'signOut',
        'push /prisijungti',
      ]);
    });
    expect(window.localStorage.getItem(queueKey('rokas'))).toBeNull();
    expect(window.localStorage.getItem(queueKey('gabija'))).toBeNull();
    expect(window.localStorage.getItem('theme')).toBe('dark');
  });
});
