import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../../i18n/locales';
import type { AssignedRepertoirePage } from '../../../../server/assignment-pages';
import AssignedRepertoireLoading from './loading';
import AssignedRepertoireNotFound from './not-found';
import AssignedRepertoirePageView from './page';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

const loader = vi.hoisted(() => ({
  data: vi.fn<(id: unknown) => Promise<AssignedRepertoirePage>>(),
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

describe('the assigned repertoire page', () => {
  it('loads the repertoire the path names and shows it', async () => {
    loader.data.mockResolvedValue({
      repertoire: {
        id: ID,
        name: 'Londono sistema',
        side: 'white',
        version: 1,
      },
      coachName: 'Jonas',
      graph: graphOf(LONDON),
      personalNotes: {},
      paused: false,
      ecoNames: {},
      changes: { added: [], removed: [], annotated: 0 },
    });
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
