import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../../i18n/catalogue';
import type { AssignedRepertoirePage } from '../../../../server/assignment-pages';
import AssignedRepertoireNotFound from '../not-found';
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
  markSeenAction: vi.fn(() => Promise.resolve()),
  setPersonalNoteAction: vi.fn(),
}));

const renderLt = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
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
    names: { taxonomyNames: {}, distinctions: {} },
    changes: { added: [], removed: [], commentsChanged: 0 },
  };
}

describe('the assigned repertoire page', () => {
  beforeEach(() => {
    loader.training.mockReset().mockResolvedValue({
      counts: { due: 3, toLearn: 5 },
      learn: {
        tracked: [],
        learnedToday: 0,
        limits: { reviews: 20, newPerDay: 5 },
      },
      limitReached: false,
      standing: {
        counts: { notStarted: 10, skipped: 0, due: 0, learned: 0 },
        mastered: false,
      },
      chapters: {},
    });
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
      screen.getByRole('link', { name: 'Review 3' }).getAttribute('href'),
    ).toBe(`/training?mode=review&r=${ID}`);
    expect(screen.getByRole('link', { name: 'Learn 5 today' })).toBeDefined();
  });

  it('hides Review, Learn and "I know this" while paused, and says it is paused (R-46)', async () => {
    loader.data.mockResolvedValue(london(true));
    renderLt(
      await AssignedRepertoirePageView({ params: Promise.resolve({ id: ID }) }),
    );
    expect(screen.queryByRole('link', { name: /Review/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Learn/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /I know this or learn again/ }),
    ).toBeNull();
    expect(screen.getByText(MESSAGES.assignment.badge.paused)).toBeDefined();
  });
});

describe('the assigned repertoire page when it is not the player’s', () => {
  it('says so and leads back to Repertoires', () => {
    renderLt(<AssignedRepertoireNotFound />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: MESSAGES.assignment.page.notFound,
      }),
    ).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: 'Back to Repertoires' })
        .getAttribute('href'),
    ).toBe('/repertoires');
  });
});
