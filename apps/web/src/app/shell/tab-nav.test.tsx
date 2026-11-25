import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { TabNav } from './tab-nav';

const path = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => path.current }));

const show = (props: { isCoach: boolean; due: number }, at: string) => {
  path.current = at;
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <TabNav {...props} />
    </NextIntlClientProvider>,
  );
  return screen.getByRole('navigation', { name: 'Main' });
};

describe('TabNav', () => {
  it('lists a player three tabs, the current one marked', () => {
    const nav = show({ isCoach: false, due: 0 }, '/repertoires/import');
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Today',
      'Repertoires',
      'Opponents',
    ]);
    const current = (name: string) =>
      within(nav).getByRole('link', { name }).getAttribute('aria-current');
    expect(current('Repertoires')).toBe('page');
    expect(current('Today')).toBeNull();
  });

  it('adds Coach for a coach', () => {
    const nav = show({ isCoach: true, due: 0 }, '/coach/groups/g1');
    const coach = within(nav).getByRole('link', { name: 'Coach' });
    expect(coach.getAttribute('href')).toBe('/coach');
    expect(coach.getAttribute('aria-current')).toBe('page');
  });

  it('names the due count on Today, capped at 99+ on the badge', () => {
    const nav = show({ isCoach: false, due: 120 }, '/');
    const today = within(nav).getByRole('link', { name: 'Today, 120 due' });
    expect(today.textContent).toContain('99+');
  });
});
