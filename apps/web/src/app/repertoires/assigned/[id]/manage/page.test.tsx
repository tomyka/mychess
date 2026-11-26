import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../../../i18n/catalogue';
import type { AssignedRepertoirePage } from '../../../../../server/assignment-pages';
import ManageLoading from './loading';
import AssignedManagePage from './page';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const NOT_FOUND = 'NEXT_NOT_FOUND';
const a = MESSAGES.assignment;

const loader = vi.hoisted(() => ({
  data: vi.fn<(id: unknown) => Promise<AssignedRepertoirePage>>(),
}));

// The loader's access check (404 unless assigned to the session player
// now, live and not forked) is its own test and the feature suite's.
vi.mock('../../../../../server/assignment-pages', () => ({
  assignedRepertoireData: loader.data,
}));

vi.mock('../actions', () => ({ pauseAction: vi.fn(), forkAction: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const renderIn = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {node}
    </NextIntlClientProvider>,
  );

const page = (search: Record<string, string> = {}) =>
  AssignedManagePage({
    params: Promise.resolve({ id: ID }),
    searchParams: Promise.resolve(search),
  });

/** Rokas's London from Jonas, as the loader gives it. */
function london(paused: boolean): AssignedRepertoirePage {
  return {
    repertoire: { id: ID, name: 'Londono sistema', side: 'white', version: 1 },
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

const forkQuestion = a.fork.question.replace('{name}', 'Londono sistema');

beforeEach(() => {
  loader.data.mockReset().mockResolvedValue(london(false));
});

describe('the assigned Repertoire screen page (R-226)', () => {
  it('loads the assignment the path names and shows its actions', async () => {
    renderIn(await page());
    expect(loader.data).toHaveBeenCalledWith(ID);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: a.pause.pause })).toBeDefined();
    expect(screen.queryByText(forkQuestion)).toBeNull();
  });

  it('shows a paused assignment as paused (R-46)', async () => {
    loader.data.mockResolvedValue(london(true));
    renderIn(await page());
    expect(screen.getByRole('button', { name: a.pause.resume })).toBeDefined();
  });

  it('opens the copy’s question with ?fork=1, and only then', async () => {
    renderIn(await page({ fork: '1' }));
    const fork = screen.getByRole('region', { name: a.fork.label });
    expect(within(fork).getByText(forkQuestion)).toBeDefined();
  });

  it('ignores any other fork value', async () => {
    renderIn(await page({ fork: 'yes' }));
    expect(screen.queryByText(forkQuestion)).toBeNull();
  });

  it('is a 404 wherever the loader says so', async () => {
    loader.data.mockRejectedValue(new Error(NOT_FOUND));
    await expect(page()).rejects.toThrow(NOT_FOUND);
  });
});

describe('the assigned Repertoire screen while it loads', () => {
  it('is busy, with no spinner and no text', () => {
    const { container } = renderIn(<ManageLoading />);
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toBe('');
  });
});
