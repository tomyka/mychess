import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n/catalogue';
import { GoToday } from './go-today';

const renderLink = (look: 'primary' | 'secondary'): HTMLElement => {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <GoToday look={look} />
    </NextIntlClientProvider>,
  );
  return screen.getByRole('link', { name: MESSAGES.nav.goToday });
};

describe('GoToday (#381 part 6)', () => {
  it('links to Today', () => {
    expect(renderLink('primary').getAttribute('href')).toBe('/');
  });

  // The weight is the variant's behaviour: the 404's one way on, or the
  // way out beside the error page's Try again.
  it.each([
    ['primary', 'bg-accent'],
    ['secondary', 'border-border-strong'],
  ] as const)('is a %s button', (look, mark) => {
    expect(renderLink(look).className.split(' ')).toContain(mark);
  });
});
