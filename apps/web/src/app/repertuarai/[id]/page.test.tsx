import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../i18n/locales';
import type { CoachAssignData } from '../../../server/coach-assignments';
import type { RepertoirePageData } from '../../../server/repertoires';
import RepertoireLoading from './loading';
import RepertoireNotFound from './not-found';
import RepertoirePage from './page';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

const loader = vi.hoisted(() => ({
  data: vi.fn<(id: unknown) => Promise<RepertoirePageData>>(),
  assign: vi.fn<(id: string) => Promise<CoachAssignData>>(),
  training: vi.fn<(account: unknown, id: string) => Promise<unknown>>(),
}));

// The session account; requireOnboarded's redirects are session.ts's own.
vi.mock('../../../server/session', () => ({
  requireOnboarded: () => Promise.resolve({ id: 'rokas' }),
}));

// Which counts it reads, and for whom, is the loader's own test.
vi.mock('../../../server/training', () => ({
  repertoireTraining: loader.training,
}));

vi.mock('../know-actions', () => ({
  knowCountAction: vi.fn(),
  markKnownAction: vi.fn(),
  learnAgainAction: vi.fn(),
}));

// The loader's access check (404 for anything not the viewer's) and its
// sign-in redirect are covered by the feature suite.
vi.mock('../../../server/repertoires', () => ({
  repertoirePageData: loader.data,
}));

vi.mock('@lichess-org/chessground', () => ({
  Chessground: () => ({
    set: vi.fn(),
    setShapes: vi.fn(),
    selectSquare: vi.fn(),
    destroy: vi.fn(),
    state: { drawable: { current: undefined } },
  }),
}));

vi.mock('./actions', () => ({
  savePersonalNoteAction: vi.fn(),
  renameRepertoireAction: vi.fn(),
  deleteRepertoireAction: vi.fn(),
}));

vi.mock('./sharing-actions', () => ({ setSharesAction: vi.fn() }));

// Which assignments it reads, and for whom, is the loader's own test.
vi.mock('../../../server/coach-assignments', () => ({
  coachAssignData: loader.assign,
}));

vi.mock('./assign-actions', () => ({
  assignAction: vi.fn(),
  unassignAction: vi.fn(),
  setDeadlineAction: vi.fn(),
  clearDeadlineAction: vi.fn(),
}));

const NOT_COACHING: CoachAssignData = { assignedPlayers: 0, panel: null };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const NOW = new Date('2026-10-18T08:00:00Z');

/** Rokas's London (two chapters) as the loader gives it. */
const LONDON_DATA: RepertoirePageData = {
  repertoire: {
    id: ID,
    ownerId: 'rokas',
    side: 'white',
    name: 'Londono sistema',
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
  },
  graph: graphOf(LONDON),
  notes: {},
  names: { ecoNames: {}, distinctions: {} },
  sharing: { coaches: [], sharedWith: [] },
  coachNotes: [],
  forkNotes: [],
};

const NO_QUERY = Promise.resolve({});

function renderIn(element: React.ReactNode): void {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      {element}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  loader.assign.mockReset().mockResolvedValue(NOT_COACHING);
  loader.training.mockReset().mockResolvedValue({ due: 4, toLearn: 6 });
});

describe('the repertoire page', () => {
  it('opens on the chapter the query names, else on the first (screen note)', async () => {
    loader.data.mockResolvedValue(LONDON_DATA);
    const open = async (chapter?: string | string[]) => {
      const { unmount } = render(
        <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
          {await RepertoirePage({
            params: Promise.resolve({ id: ID }),
            searchParams: Promise.resolve({ chapter }),
          })}
        </NextIntlClientProvider>,
      );
      const said = screen.getByText(/^Skyrius \d iš 2$/u).textContent;
      unmount();
      return said;
    };
    expect(await open('c2')).toBe('Skyrius 2 iš 2');
    expect(await open('c9')).toBe('Skyrius 1 iš 2');
    expect(await open(['c2', 'c1'])).toBe('Skyrius 1 iš 2');
    expect(await open()).toBe('Skyrius 1 iš 2');
  });

  it('loads the repertoire of the id and shows it', async () => {
    loader.data.mockResolvedValue(LONDON_DATA);
    renderIn(
      await RepertoirePage({
        params: Promise.resolve({ id: ID }),
        searchParams: NO_QUERY,
      }),
    );
    expect(loader.data).toHaveBeenCalledWith(ID);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(screen.getByRole('application')).toBeDefined();
  });

  it('trains the repertoire from its page, with its counts (R-142)', async () => {
    loader.data.mockResolvedValue(LONDON_DATA);
    renderIn(
      await RepertoirePage({
        params: Promise.resolve({ id: ID }),
        searchParams: NO_QUERY,
      }),
    );
    expect(loader.training).toHaveBeenCalledWith({ id: 'rokas' }, ID);
    expect(
      screen.getByRole('link', { name: 'Kartoti (4)' }).getAttribute('href'),
    ).toBe(`/treniruote?mode=review&r=${ID}`);
    expect(
      screen.getByRole('link', { name: 'Mokytis (6)' }).getAttribute('href'),
    ).toBe(`/treniruote?mode=learn&r=${ID}`);
  });

  it('shows the assign panel only in Coach mode (R-15)', async () => {
    loader.data.mockResolvedValue(LONDON_DATA);
    const page = () =>
      RepertoirePage({
        params: Promise.resolve({ id: ID }),
        searchParams: NO_QUERY,
      });
    const title = MESSAGES.lt.assignment.panel.title;
    const { unmount } = render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        {await page()}
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('heading', { name: title })).toBeNull();
    unmount();
    loader.assign.mockResolvedValue({
      assignedPlayers: 0,
      panel: { players: [], groups: [], assignments: [] },
    });
    renderIn(await page());
    expect(loader.assign).toHaveBeenCalledWith(ID);
    expect(screen.getByRole('heading', { name: title })).toBeDefined();
  });

  it('says the same thing for a missing and a foreign repertoire', () => {
    renderIn(<RepertoireNotFound />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: MESSAGES.lt.repertoire.notFound,
      }),
    ).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: MESSAGES.lt.repertoires.header.back })
        .getAttribute('href'),
    ).toBe('/repertuarai');
  });

  it('shows a busy board frame while it loads', () => {
    renderIn(<RepertoireLoading />);
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('application')).toBeNull();
  });

  it('says it is loading only after about a second', () => {
    vi.useFakeTimers();
    try {
      renderIn(<RepertoireLoading />);
      const line = screen.getByRole('status');
      expect(line.textContent).toBe('');
      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(line.textContent).toBe('');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(line.textContent).toBe(MESSAGES.lt.repertoires.loading);
    } finally {
      vi.useRealTimers();
    }
  });
});
