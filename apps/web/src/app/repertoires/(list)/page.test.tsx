import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/catalogue';
import RepertoiresLoading from './loading';
import RepertoiresPage from './page';

// requireOnboarded never returns for a signed-out or new account; the
// feature suite covers that.
const ROKAS = { id: 'rokas' };

const LONDON = {
  id: 'r-1',
  side: 'white',
  name: 'Londono sistema',
  chapters: 2,
  moves: 21,
  updatedAt: new Date('2026-10-18T08:00:00Z'),
  forkCoachName: null,
  assignedTo: 0,
};

const CARO = {
  repertoireId: 'a-1',
  name: 'Karo-Kan gynyba',
  side: 'black',
  coachName: 'Jonas',
  deadline: null,
  badges: { overdue: false, paused: false, forked: false, updated: true },
};

const server = vi.hoisted(() => ({
  account: vi.fn<() => Promise<unknown>>(),
  own: vi.fn<() => Promise<unknown[]>>(),
  assigned: vi.fn<() => Promise<unknown[]>>(),
  standings: vi.fn<(account: unknown) => Promise<unknown>>(),
}));

vi.mock('../../../server/session', () => ({
  requireOnboarded: server.account,
}));
vi.mock('../../../server/repertoires', () => ({ myRepertoires: server.own }));
vi.mock('../../../server/assignment-pages', () => ({
  myAssignedRepertoires: server.assigned,
}));
vi.mock('../../../server/training', () => ({
  trainedStandings: server.standings,
}));

beforeEach(() => {
  server.account.mockReset().mockResolvedValue(ROKAS);
  server.own.mockReset().mockResolvedValue([LONDON]);
  server.assigned.mockReset().mockResolvedValue([CARO]);
  server.standings.mockReset().mockResolvedValue(
    new Map([
      [
        'r-1',
        {
          standing: {
            counts: { notStarted: 1, skipped: 0, due: 3, learned: 6 },
            mastered: false,
          },
          due: 3,
        },
      ],
    ]),
  );
});

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
  it('shows the title, the repertoires with their standing, New and the import link', async () => {
    await renderPage();
    // The session account's standings, from the read Today shares (R-225).
    expect(server.standings).toHaveBeenCalledExactlyOnceWith(ROKAS);
    expect(screen.getByText('60% learned · 3 due')).toBeDefined();
    expect(
      screen.getByRole('heading', { level: 1, name: l.title }),
    ).toBeDefined();
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
    // With repertoires, the create form waits behind New.
    expect(
      screen.getByRole('button', { name: l.new }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(
      screen.queryByRole('region', { name: MESSAGES.repertoires.create.title }),
    ).toBeNull();
    expect(
      screen.getByRole('link', { name: l.import }).getAttribute('href'),
    ).toBe('/repertoires/import');
    expect(screen.queryByText(MESSAGES.repertoires.manage.deleted)).toBeNull();
  });

  it('opens the create form for an account with no repertoire at all, under the empty line', async () => {
    server.own.mockResolvedValue([]);
    server.assigned.mockResolvedValue([]);
    server.standings.mockResolvedValue(new Map());
    await renderPage();
    const empty = screen.getByText(l.empty);
    const form = screen.getByRole('region', {
      name: MESSAGES.repertoires.create.title,
    });
    expect(
      empty.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('opens the create form above the list, pushing it down', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: l.new }));
    const form = screen.getByRole('region', {
      name: MESSAGES.repertoires.create.title,
    });
    const card = screen.getByRole('link', { name: 'Londono sistema' });
    expect(
      form.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('says the repertoire was deleted after a delete', async () => {
    await renderPage({ deleted: '1' });
    expect(
      screen
        .getByText(MESSAGES.repertoires.manage.deleted)
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
