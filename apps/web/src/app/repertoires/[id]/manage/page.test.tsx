import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../../i18n/catalogue';
import type { CoachAssignData } from '../../../../server/coach-assignments';
import ManageLoading from './loading';
import ManagePage from './page';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const DB = { name: 'the db' };
const NOW = new Date('2026-11-26T08:00:00Z');
const NOT_FOUND = 'NEXT_NOT_FOUND';

const server = vi.hoisted(() => ({
  load: vi.fn<
    (db: unknown, id: string, viewerId: string) => Promise<unknown>
  >(),
  coaches: vi.fn<(db: unknown, ownerId: string) => Promise<unknown>>(),
  shared:
    vi.fn<(db: unknown, ownerId: string, id: string) => Promise<string[]>>(),
  assign: vi.fn<(id: string) => Promise<CoachAssignData>>(),
}));

// The owner-filtered read: the db returns nothing for a repertoire the
// account does not own, one only assigned to it included.
vi.mock('@mychess/db', () => ({
  loadRepertoire: server.load,
  playerCoaches: server.coaches,
  sharedCoachIds: server.shared,
}));
vi.mock('../../../../server/db', () => ({ getDb: () => DB }));
vi.mock('../../../../server/session', () => ({
  requireOnboarded: () => Promise.resolve({ id: 'rokas', coachSince: null }),
}));
// Which assignments it reads, and for whom, is the loader's own test.
vi.mock('../../../../server/coach-assignments', () => ({
  coachAssignData: server.assign,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../actions', () => ({
  renameRepertoireAction: vi.fn(),
  deleteRepertoireAction: vi.fn(),
}));
vi.mock('../sharing-actions', () => ({ setSharesAction: vi.fn() }));
vi.mock('../assign-actions', () => ({
  assignAction: vi.fn(),
  unassignAction: vi.fn(),
  setDeadlineAction: vi.fn(),
  clearDeadlineAction: vi.fn(),
}));

const renderIn = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {node}
    </NextIntlClientProvider>,
  );

const page = (id: string) => ManagePage({ params: Promise.resolve({ id }) });

beforeEach(() => {
  server.load.mockReset().mockResolvedValue({
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
  });
  server.coaches
    .mockReset()
    .mockResolvedValue([{ id: 'c-1', displayName: 'Dovydas' }]);
  server.shared.mockReset().mockResolvedValue(['c-1']);
  server.assign
    .mockReset()
    .mockResolvedValue({ assignedPlayers: 0, panel: null });
});

describe('the Repertoire screen page (R-226)', () => {
  it('shows the session account’s own repertoire, read for them', async () => {
    renderIn(await page(ID));
    expect(server.load).toHaveBeenCalledWith(DB, ID, 'rokas');
    expect(server.assign).toHaveBeenCalledWith(ID);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(screen.getByText('Shared with 1 coach')).toBeDefined();
    expect(
      screen.queryByRole('heading', {
        name: MESSAGES.assignment.panel.list,
      }),
    ).toBeNull();
  });

  it('is a 404 for a malformed id, read nowhere', async () => {
    await expect(page('not-a-uuid')).rejects.toThrow(NOT_FOUND);
    expect(server.load).not.toHaveBeenCalled();
    expect(server.assign).not.toHaveBeenCalled();
  });

  it('is a 404 for a repertoire the account only has by assignment', async () => {
    server.load.mockResolvedValue(undefined);
    await expect(page(ID)).rejects.toThrow(NOT_FOUND);
    expect(server.assign).not.toHaveBeenCalled();
  });
});

describe('the Repertoire screen while it loads', () => {
  it('is busy, with no spinner and no text', () => {
    const { container } = renderIn(<ManageLoading />);
    const main = screen.getByRole('main');
    expect(main.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toBe('');
  });
});
