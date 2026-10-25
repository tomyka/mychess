import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../../i18n/locales';
import type { AssignedRepertoirePage } from '../../../../server/assignment-pages';
import AssignedRepertoireLoading from './loading';
import AssignedRepertoireNotFound from './not-found';
import AssignedRepertoirePageView from './page';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

const loader = vi.hoisted(() => ({
  data: vi.fn<(id: unknown) => Promise<AssignedRepertoirePage>>(),
  training: vi.fn<(account: unknown, id: string) => Promise<unknown>>(),
}));

// The session account; requireOnboarded's redirects are session.ts's own.
vi.mock('../../../../server/session', () => ({
  requireOnboarded: () => Promise.resolve({ id: 'rokas' }),
}));

// Which counts it reads, and for whom, is the loader's own test.
vi.mock('../../../../server/training', () => ({
  repertoireTraining: loader.training,
}));

vi.mock('../../know-actions', () => ({
  knowCountAction: vi.fn(),
  markKnownAction: vi.fn(),
  learnAgainAction: vi.fn(),
}));

// The loader's access check (404 unless assigned to the session player
// now, live) is covered by its own test and the feature suite.
vi.mock('../../../../server/assignment-pages', () => ({
  assignedRepertoireData: loader.data,
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
  pauseAction: vi.fn(),
  forkAction: vi.fn(),
  markSeenAction: vi.fn(() => Promise.resolve()),
  setPersonalNoteAction: vi.fn(),
}));

const renderLt = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      {node}
    </NextIntlClientProvider>,
  );

/** Rokas's London from Jonas, as the loader gives it. */
function london(paused: boolean): AssignedRepertoirePage {
  return {
    repertoire: {
      id: ID,
      name: 'Londono sistema',
      side: 'white',
      version: 1,
    },
    coachName: 'Jonas',
    graph: graphOf(LONDON),
    personalNotes: {},
    paused,
    deadline: null,
    overdue: false,
    ecoNames: {},
    changes: { added: [], removed: [], commentsChanged: 0 },
  };
}

describe('the assigned repertoire page', () => {
  beforeEach(() => {
    loader.training.mockReset().mockResolvedValue({ due: 3, toLearn: 5 });
  });

  it('loads the repertoire the path names and shows it', async () => {
    loader.data.mockResolvedValue(london(false));
    renderLt(
      await AssignedRepertoirePageView({
        params: Promise.resolve({ id: ID }),
      }),
    );
    expect(loader.data).toHaveBeenCalledWith(ID);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(screen.getByRole('application')).toBeDefined();
  });

  it('trains it from its page, with its counts (R-142)', async () => {
    loader.data.mockResolvedValue(london(false));
    renderLt(
      await AssignedRepertoirePageView({ params: Promise.resolve({ id: ID }) }),
    );
    expect(loader.training).toHaveBeenCalledWith({ id: 'rokas' }, ID);
    expect(
      screen.getByRole('link', { name: 'Kartoti (3)' }).getAttribute('href'),
    ).toBe(`/treniruote?mode=review&r=${ID}`);
    expect(screen.getByRole('link', { name: 'Mokytis (5)' })).toBeDefined();
  });

  it('hides the train buttons and "I know this" while paused (R-46)', async () => {
    loader.data.mockResolvedValue(london(true));
    renderLt(
      await AssignedRepertoirePageView({ params: Promise.resolve({ id: ID }) }),
    );
    expect(screen.queryByRole('link', { name: /Kartoti/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Mokytis/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Žinau arba mokytis iš naujo/ }),
    ).toBeNull();
    expect(
      screen.getByText(MESSAGES.lt.assignment.pause.pausedHint),
    ).toBeDefined();
  });
});

describe('the assigned repertoire page when it is not the player’s', () => {
  it('says so and leads home', () => {
    renderLt(<AssignedRepertoireNotFound />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: MESSAGES.lt.assignment.page.notFound,
      }),
    ).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: MESSAGES.lt.assignment.page.home })
        .getAttribute('href'),
    ).toBe('/');
  });
});

describe('the assigned repertoire page while it loads', () => {
  it('shows a busy board frame with no board', () => {
    renderLt(<AssignedRepertoireLoading />);
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('application')).toBeNull();
  });

  it('says it is loading only after about a second', () => {
    vi.useFakeTimers();
    try {
      renderLt(<AssignedRepertoireLoading />);
      const line = screen.getByRole('status');
      expect(line.textContent).toBe('');
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(line.textContent).toBe(MESSAGES.lt.repertoires.loading);
    } finally {
      vi.useRealTimers();
    }
  });
});
