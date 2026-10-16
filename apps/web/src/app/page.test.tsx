import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/locales';
import { HomeView } from './home-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('../lib/auth-client', () => ({
  authClient: { signOut: vi.fn() },
}));

const greetings = { lt: 'Sveiki, Rūta!', en: 'Hello, Rūta!' } as const;
const signOut = { lt: 'Atsijungti', en: 'Sign out' } as const;

describe('HomeView', () => {
  it.each(['lt', 'en'] as const)(
    'names the site and greets the account in %s',
    (locale) => {
      render(
        <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
          <HomeView displayName="Rūta" />
        </NextIntlClientProvider>,
      );
      expect(
        screen.getByRole('heading', { level: 1, name: 'mychess' }),
      ).toBeDefined();
      expect(screen.getByText(greetings[locale])).toBeDefined();
      expect(
        screen.getByRole('button', { name: signOut[locale] }),
      ).toBeDefined();
    },
  );
});
