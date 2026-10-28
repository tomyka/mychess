import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import {
  graphOf,
  TAIMANOV,
} from '../../../../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../../../../i18n/locales';
import type { SharedRepertoirePage } from '../../../../../../server/coach-pages';
import SharedRepertoireLoading from './loading';
import CoachSharedRepertoirePage from './page';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

const loader = vi.hoisted(() => ({
  shared:
    vi.fn<
      (player: unknown, repertoire: unknown) => Promise<SharedRepertoirePage>
    >(),
}));

// The loader's access check (404 unless shared with this coach through an
// active link) and its redirects are covered by the feature suite.
vi.mock('../../../../../../server/coach-pages', () => ({
  sharedRepertoireData: loader.shared,
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

vi.mock('../../../../actions', () => ({
  saveCoachNoteAction: vi.fn(),
  deleteCoachNoteAction: vi.fn(),
}));

describe('the coach’s page of a shared repertoire', () => {
  it('loads the repertoire the path names and shows it read-only', async () => {
    loader.shared.mockResolvedValue({
      player: { id: 'p-1', displayName: 'Gabija' },
      repertoire: { id: ID, name: 'Taimanovas', side: 'black' },
      graph: graphOf(TAIMANOV, 'black'),
      notes: {},
      names: { ecoNames: {}, distinctions: {} },
    });
    render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        {await CoachSharedRepertoirePage({
          params: Promise.resolve({ playerId: 'p-1', repertoireId: ID }),
        })}
      </NextIntlClientProvider>,
    );
    expect(loader.shared).toHaveBeenCalledWith('p-1', ID);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Taimanovas' }),
    ).toBeDefined();
    expect(screen.getByText(MESSAGES.lt.coach.shared.readOnly)).toBeDefined();
    expect(screen.getByRole('application')).toBeDefined();
  });
});

describe('the coach’s page of a shared repertoire while it loads', () => {
  const renderLoading = () =>
    render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        <SharedRepertoireLoading />
      </NextIntlClientProvider>,
    );

  it('shows a busy board frame with no board', () => {
    renderLoading();
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('application')).toBeNull();
  });

  it('says it is loading only after about a second', () => {
    vi.useFakeTimers();
    try {
      renderLoading();
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
