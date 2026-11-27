import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n/catalogue';
import { AssignmentBadges } from './assignment-badges';
import { MasteredBadge } from './mastered-badge';
import { Pill, pillClass } from './pill';

describe('Pill', () => {
  it('is one rounded, bordered, small-type pill in every tone', () => {
    render(<Pill tone="done">Done</Pill>);
    const pill = screen.getByText('Done');
    expect(pill.className).toContain('rounded-pill');
    expect(pill.className).toContain('text-sm');
    expect(pill.className).toContain('border');
  });

  it.each([
    ['overdue', 'bg-error-subtle'],
    ['neutral', 'border-border-strong'],
    ['done', 'border-success'],
    ['mastered', 'bg-success-subtle'],
    ['updated', 'bg-accent'],
  ] as const)('draws the %s tone with %s', (tone, colour) => {
    expect(pillClass(tone)).toContain(colour);
  });

  it('draws Done as a green outline without a fill', () => {
    expect(pillClass('done')).not.toContain('bg-');
    expect(pillClass('done')).toContain('text-success');
  });
});

describe('the pills that use it', () => {
  const wrap = (node: ReactNode): void => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        {node}
      </NextIntlClientProvider>,
    );
  };

  it('draws Mastered as the mastered pill', () => {
    wrap(<MasteredBadge />);
    expect(screen.getByText('Mastered').className).toBe(pillClass('mastered'));
  });

  it('draws the assignment badges as pills', () => {
    wrap(
      <AssignmentBadges
        flags={{ overdue: true, paused: true, updated: true }}
      />,
    );
    expect(screen.getByText('Overdue').className).toBe(pillClass('overdue'));
    expect(screen.getByText('Paused').className).toBe(pillClass('neutral'));
    expect(screen.getByText('Updated').className).toBe(pillClass('updated'));
  });
});
