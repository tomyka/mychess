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
const settings = { lt: 'Nustatymai', en: 'Settings' } as const;

describe('HomeView', () => {
  it.each(['lt', 'en'] as const)(
    'names the site and greets the account in %s',
    (locale) => {
      render(
        <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
          <HomeView displayName="Rūta" />
        </NextIntlClientProvider>,
      );
      // The brand is a label, as on the other pages; the greeting is the
      // page's one heading, the h1.
      expect(screen.getByText('mychess').tagName).toBe('P');
      expect(
        screen.getAllByRole('heading').map((h) => [h.tagName, h.textContent]),
      ).toEqual([['H1', greetings[locale]]]);
      expect(
        screen.getByRole('button', { name: signOut[locale] }),
      ).toBeDefined();
      expect(
        screen
          .getByRole('link', { name: settings[locale] })
          .getAttribute('href'),
      ).toBe('/nustatymai');
    },
  );
});
