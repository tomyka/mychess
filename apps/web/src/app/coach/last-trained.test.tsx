import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { LastTrained, LastTrainedNote } from './last-trained';

const p = MESSAGES.coach.progress;

const show = (days: number | null): void => {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <LastTrained days={days} />
    </NextIntlClientProvider>,
  );
};

describe('LastTrained (R-154)', () => {
  it('says today for 0 days', () => {
    show(0);
    expect(screen.getByText(p.today)).toBeTruthy();
  });

  it('says yesterday for 1 day', () => {
    show(1);
    expect(screen.getByText(p.yesterday)).toBeTruthy();
  });

  it.each([2, 10, 21])(
    'says %i days ago on the repertoires the coach sees',
    (days) => {
      show(days);
      expect(
        screen.getByText(
          `Last trained ${String(days)} days ago on the repertoires you can see`,
        ),
      ).toBeTruthy();
    },
  );

  // Another coach's repertoires are not counted: a player who trained
  // yesterday elsewhere must not read as idle (R-154, #329).
  it.each([
    [0, 'Last trained today on the repertoires you can see'],
    [1, 'Last trained yesterday on the repertoires you can see'],
  ])('scopes %i days to the repertoires the coach sees', (days, said) => {
    show(days);
    expect(screen.getByText(said)).toBeTruthy();
  });

  it('scopes every English line to the repertoires the coach sees', () => {
    const en = MESSAGES.coach.progress;
    for (const line of [en.today, en.yesterday, en.daysAgo])
      expect(line).toContain('on the repertoires you can see');
  });

  it('says not trained yet without a result', () => {
    show(null);
    expect(screen.getByText(p.neverTrained)).toBeTruthy();
  });

  it('says only what holds: no training on the repertoires the coach sees, not none at all (R-154, #329)', () => {
    show(null);
    expect(
      screen.getByText('Not trained yet on the repertoires you can see'),
    ).toBeTruthy();
  });
});

const showShort = (days: number | null): HTMLElement => {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <LastTrained days={days} form="short" />
    </NextIntlClientProvider>,
  );
  return container;
};

describe('LastTrained, short form (R-231)', () => {
  it.each([
    [0, 'today'],
    [1, 'yesterday'],
    [5, '5 days ago'],
    [null, 'never'],
  ])('says %s days as "%s"', (days, said) => {
    expect(showShort(days).textContent).toBe(said);
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
