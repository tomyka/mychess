import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../i18n/catalogue';
import type { RepertoirePageData } from '../../../server/repertoires';
import { pageTraining } from '../../repertoire-view/test-training';
import RepertoireLoading from './loading';
import RepertoireNotFound from '../not-found';
import RepertoirePage from './page';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

const loader = vi.hoisted(() => ({
  data: vi.fn<(id: unknown) => Promise<RepertoirePageData>>(),
}));

vi.mock('../know-actions', () => ({
  knowCountAction: vi.fn(),
  markKnownAction: vi.fn(),
  learnAgainAction: vi.fn(),
}));

// The loader's access check (404 for anything not the viewer's) and its
// sign-in redirect are covered by the feature suite; which training it
// reads, and for whom, by its own test.
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

/** Rokas's London (two chapters) as the loader gives it. */
const LONDON_DATA: RepertoirePageData = {
  repertoire: { id: ID, side: 'white', name: 'Londono sistema', version: 2 },
  graph: graphOf(LONDON),
  notes: {},
  names: { taxonomyNames: {}, distinctions: {} },
  coachNotes: [],
  forkNotes: [],
  training: pageTraining(
    { repertoireId: ID, counts: { due: 4, toLearn: 6 } },
    {
      counts: { notStarted: 10, skipped: 0, due: 0, learned: 0 },
      mastered: false,
    },
  ),
};

const NO_QUERY = Promise.resolve({});

function renderIn(element: React.ReactNode): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {element}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  loader.data.mockReset().mockResolvedValue(LONDON_DATA);
});

describe('the repertoire page', () => {
  it('opens on the chapter the query names, else on the first (screen note)', async () => {
    const open = async (chapter?: string | string[]) => {
      const { unmount } = render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          {await RepertoirePage({
            params: Promise.resolve({ id: ID }),
            searchParams: Promise.resolve({ chapter }),
          })}
        </NextIntlClientProvider>,
      );
      const said = screen.getByText(/^Ch \d+\/2 · /u).textContent;
      unmount();
      return /^Ch (\d+)\/2/u.exec(said)?.[1];
    };
    expect(await open('c2')).toBe('2');
    expect(await open('c9')).toBe('1');
    expect(await open(['c2', 'c1'])).toBe('1');
    expect(await open()).toBe('1');
  });

  it('loads the repertoire of the id and shows it', async () => {
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
    renderIn(
      await RepertoirePage({
        params: Promise.resolve({ id: ID }),
        searchParams: NO_QUERY,
      }),
    );
    expect(
      screen.getByRole('link', { name: 'Review 4' }).getAttribute('href'),
    ).toBe(`/training?mode=review&r=${ID}`);
    expect(
      screen.getByRole('link', { name: 'Learn 6 today' }).getAttribute('href'),
    ).toBe(`/training?mode=learn&r=${ID}`);
  });

  it('leaves assigning and sharing to its Repertoire screen (R-226)', async () => {
    renderIn(
      await RepertoirePage({
        params: Promise.resolve({ id: ID }),
        searchParams: NO_QUERY,
      }),
    );
    expect(
      screen.queryByRole('heading', { name: MESSAGES.assignment.panel.title }),
    ).toBeNull();
    expect(
      screen.queryByRole('heading', { name: MESSAGES.share.title }),
    ).toBeNull();
    expect(
      screen
        .getByRole('link', { name: MESSAGES.repertoires.more })
        .getAttribute('href'),
    ).toBe(`/repertoires/${ID}/manage`);
  });

  it('says the same thing for a missing and a foreign repertoire', () => {
    renderIn(<RepertoireNotFound />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: MESSAGES.repertoire.notFound,
      }),
    ).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: 'Back to Repertoires' })
        .getAttribute('href'),
    ).toBe('/repertoires');
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
      expect(line.textContent).toBe(MESSAGES.repertoires.loading);
    } finally {
      vi.useRealTimers();
    }
  });
});
