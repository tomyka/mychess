import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n/catalogue';
import type { AssignedListItem } from '../server/assignment-pages';
import { FromMyCoach } from './from-my-coach';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const a = MESSAGES.assignment;
const badge = a.badge;

const day = (iso: string): string =>
  new Intl.DateTimeFormat('en', {
    dateStyle: 'long',
    timeZone: 'Europe/Vilnius',
  }).format(new Date(`${iso}T12:00:00Z`));

const LONDON: AssignedListItem = {
  repertoireId: ID,
  name: 'Londono sistema',
  side: 'white',
  coachName: 'Jonas',
  deadline: '2026-11-30',
  badges: { overdue: true, paused: true, forked: false, updated: true },
};

const CARO: AssignedListItem = {
  repertoireId: 'c4f0a2b1-1d2e-4f3a-8b5c-6d7e8f9a0b1c',
  name: 'Karo-Kan gynyba: pagrindai',
  side: 'black',
  coachName: 'Rimantas',
  deadline: null,
  badges: { overdue: false, paused: false, forked: false, updated: false },
};

function renderList(assignments: readonly AssignedListItem[]): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <FromMyCoach assignments={assignments} />
    </NextIntlClientProvider>,
  );
}

const item = (name: string): HTMLElement => {
  const li = screen.getByRole('link', { name }).closest('li');
  if (li === null) throw new Error(`no item for ${name}`);
  return li;
};

describe('FromMyCoach (R-15, R-51, R-133)', () => {
  it('lists each assignment under its heading, linked to its page', () => {
    renderList([LONDON, CARO]);
    expect(
      screen.getByRole('heading', { level: 2, name: a.home.title }),
    ).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: 'Londono sistema' })
        .getAttribute('href'),
    ).toBe(`/repertuarai/priskirti/${ID}`);
    expect(
      within(item('Karo-Kan gynyba: pagrindai')).getByText(
        a.page.assignedBy.replace('{name}', 'Rimantas'),
      ),
    ).toBeDefined();
  });

  it('shows the deadline in Vilnius time and the badges', () => {
    renderList([LONDON, CARO]);
    const london = item('Londono sistema');
    expect(
      within(london).getByText(`Deadline: ${day('2026-11-30')}`),
    ).toBeDefined();
    expect(within(london).getByText(badge.overdue)).toBeDefined();
    expect(within(london).getByText(badge.paused)).toBeDefined();
    expect(within(london).getByText(badge.updated)).toBeDefined();

    const caro = item('Karo-Kan gynyba: pagrindai');
    expect(within(caro).queryByText(/Deadline/u)).toBeNull();
    expect(within(caro).queryByRole('list')).toBeNull();
  });

  it('is not shown without assignments', () => {
    renderList([]);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.body.textContent).toBe('');
  });
});
