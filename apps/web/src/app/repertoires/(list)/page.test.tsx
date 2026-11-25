import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/catalogue';
import RepertoiresLoading from './loading';
import RepertoiresPage from './page';

// requireOnboarded, inside the loader, never returns for a signed-out or
// new account; the feature suite covers that.
vi.mock('../../../server/repertoires', () => ({
  myRepertoires: () =>
    Promise.resolve([
      {
        id: 'r-1',
        side: 'white',
        name: 'Londono sistema',
        chapters: 2,
        moves: 21,
        updatedAt: new Date('2026-10-18T08:00:00Z'),
        forkCoachName: null,
      },
    ]),
}));

vi.mock('../../../server/assignment-pages', () => ({
  myAssignedRepertoires: () =>
    Promise.resolve([
      {
        repertoireId: 'a-1',
        name: 'Karo-Kan gynyba',
        side: 'black',
        coachName: 'Jonas',
        deadline: null,
        badges: { overdue: false, paused: false, forked: false, updated: true },
      },
    ]),
}));

vi.mock('../actions', () => ({ createRepertoireAction: vi.fn() }));

const l = MESSAGES.repertoires.list;

async function renderPage(params: Record<string, string> = {}): Promise<void> {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      {await RepertoiresPage({ searchParams: Promise.resolve(params) })}
    </NextIntlClientProvider>,
  );
}

describe('My repertoires', () => {
  it('shows the title, the way home, the repertoires, the create form and the import link', async () => {
    await renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: l.title }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: l.home }).getAttribute('href'),
    ).toBe('/');
    expect(
      screen
        .getByRole('link', { name: 'Londono sistema' })
        .getAttribute('href'),
    ).toBe('/repertoires/r-1');
    expect(
      screen
        .getByRole('link', { name: 'Karo-Kan gynyba' })
        .getAttribute('href'),
    ).toBe('/repertoires/assigned/a-1');
    expect(screen.queryByText(l.emptyBlack)).toBeNull();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: MESSAGES.repertoires.create.title,
      }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: l.import }).getAttribute('href'),
    ).toBe('/repertoires/import');
    expect(screen.queryByText(MESSAGES.repertoires.header.deleted)).toBeNull();
  });

  it('says the repertoire was deleted after a delete', async () => {
    await renderPage({ deleted: '1' });
    expect(
      screen
        .getByText(MESSAGES.repertoires.header.deleted)
        .getAttribute('role'),
    ).toBe('status');
  });

  it('shows the header and card skeletons while it loads', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <RepertoiresLoading />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
    expect(
      screen.getByRole('heading', { level: 1, name: l.title }),
    ).toBeDefined();
  });
});
