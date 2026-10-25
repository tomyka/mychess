import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import type { TrainingData } from '../../lib/training-data';
import TrainingLoading from './loading';
import TrainingNotFound from './not-found';
import TrainingPage from './page';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const ACCOUNT = {
  id: 'a1',
  email: 'ruta@example.lt',
  displayName: 'Rūta Jonaitė',
  locale: 'lt',
  entitlement: 'free',
  admin: false,
  disabledAt: null,
  onboardedAt: new Date(),
  coachSince: null,
  createdAt: new Date(),
} as const;

const loader = vi.hoisted(() => ({
  load: vi.fn<
    (account: unknown, mode: unknown, scope: unknown) => Promise<unknown>
  >(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

// requireOnboarded never returns for a signed-out or new account
// (session-helpers.test.ts); the loader's own checks are in its test.
vi.mock('../../server/session', () => ({
  requireOnboarded: () => Promise.resolve(ACCOUNT),
}));

vi.mock('../../server/training', async (original) => ({
  ...(await original<typeof import('../../server/training')>()),
  loadTraining: loader.load,
}));

vi.mock('next/navigation', () => ({ notFound: loader.notFound }));

vi.mock('./training-screen', () => ({
  TrainingScreen: (props: {
    data: TrainingData;
    accountId: string;
    repertoireId: string | null;
  }) => (
    <p>{`${props.data.mode} for ${props.accountId} in ${String(props.repertoireId)}`}</p>
  ),
}));

const renderLt = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      {node}
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  loader.load.mockReset();
  loader.notFound.mockClear();
});

describe('the training page', () => {
  it('loads the session account’s training at the asked scope', async () => {
    loader.load.mockResolvedValue({ mode: 'learn' });
    renderLt(
      await TrainingPage({
        searchParams: Promise.resolve({ mode: 'learn', r: ID }),
      }),
    );
    expect(loader.load).toHaveBeenCalledWith(ACCOUNT, 'learn', {
      kind: 'repertoire',
      repertoireId: ID,
    });
    expect(screen.getByText(`learn for a1 in ${ID}`)).toBeDefined();
  });

  it('trains every repertoire without a scope', async () => {
    loader.load.mockResolvedValue({ mode: 'review' });
    renderLt(await TrainingPage({ searchParams: Promise.resolve({}) }));
    expect(loader.load).toHaveBeenCalledWith(ACCOUNT, 'review', {
      kind: 'all',
    });
    expect(screen.getByText('review for a1 in null')).toBeDefined();
  });

  it('is not found for a repertoire the player does not train', async () => {
    loader.load.mockResolvedValue(undefined);
    await expect(
      TrainingPage({ searchParams: Promise.resolve({ r: ID }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(loader.notFound).toHaveBeenCalledOnce();
  });
});

describe('the training page when it is not the player’s', () => {
  it('says so and leads home', () => {
    renderLt(<TrainingNotFound />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: MESSAGES.lt.training.notFound,
      }),
    ).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: MESSAGES.lt.training.home })
        .getAttribute('href'),
    ).toBe('/');
  });
});

describe('the training page while it loads', () => {
  it('shows a busy frame with the board’s squares and no board', () => {
    renderLt(<TrainingLoading />);
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('application')).toBeNull();
  });

  it('says it is loading only after about a second', () => {
    vi.useFakeTimers();
    try {
      renderLt(<TrainingLoading />);
      const line = screen.getByRole('status');
      expect(line.textContent).toBe('');
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(line.textContent).toBe(MESSAGES.lt.training.loading);
    } finally {
      vi.useRealTimers();
    }
  });
});
