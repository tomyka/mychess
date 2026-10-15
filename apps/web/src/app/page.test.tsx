import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n/locales';
import HomePage from './page';

describe('HomePage', () => {
  it.each(['lt', 'en'] as const)('shows the site title in %s', (locale) => {
    render(
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
        <HomePage />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'mychess' }),
    ).toBeDefined();
  });
});
