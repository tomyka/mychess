import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { LastTrained, LastTrainedNote, useTrainedWhen } from './last-trained';

const show = (days: number | null): HTMLElement => {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <LastTrained days={days} />
    </NextIntlClientProvider>,
  );
  return container;
};

describe('LastTrained (R-154, R-231)', () => {
  it.each([
    [0, 'today'],
    [1, 'yesterday'],
    [5, '5 days ago'],
    [null, 'never'],
  ])('says %s days as "%s"', (days, said) => {
    expect(show(days).textContent).toBe(said);
  });

  it('has no long form left in the catalogue', () => {
    const p: Record<string, unknown> = MESSAGES.coach.progress;
    for (const key of ['today', 'yesterday', 'daysAgo', 'neverTrained'])
      expect(p[key]).toBeUndefined();
  });
});

function When({ days }: { readonly days: number }): string {
  return useTrainedWhen()(days);
}

describe('useTrainedWhen', () => {
  it.each([
    [0, 'today'],
    [1, 'yesterday'],
    [12, '12 days ago'],
  ])('says %s days as "%s", for a line that says "trained …"', (days, said) => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <When days={days} />
      </NextIntlClientProvider>,
    );
    expect(container.textContent).toBe(said);
  });
});

describe('LastTrainedNote (R-154)', () => {
  it('says once what last trained counts', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <LastTrainedNote />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText('Last trained counts only the repertoires you can see.'),
    ).toBeTruthy();
  });
});
