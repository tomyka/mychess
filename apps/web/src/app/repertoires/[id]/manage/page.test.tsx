import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../i18n/catalogue';
import type { CoachAssignData } from '../../../../server/coach-assignments';
import type { RepertoireManageData } from '../../../../server/repertoires';
import ManageLoading from './loading';
import ManagePage from './page';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const NOT_FOUND = 'NEXT_NOT_FOUND';

const server = vi.hoisted(() => ({
  data: vi.fn<(id: unknown) => Promise<RepertoireManageData>>(),
  assign: vi.fn<(id: string) => Promise<CoachAssignData>>(),
}));

// The loader's access check (404 unless the session account owns it, one
// only assigned to it included) is its own test and the feature suite's.
vi.mock('../../../../server/repertoires', () => ({
  repertoireManageData: server.data,
}));
// Which assignments it reads, and for whom, is the loader's own test.
vi.mock('../../../../server/coach-assignments', () => ({
  coachAssignData: server.assign,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/repertoires/r-1/manage',
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
  server.data.mockReset().mockResolvedValue({
    repertoire: { id: ID, name: 'Londono sistema' },
    sharing: {
      coaches: [{ id: 'c-1', displayName: 'Dovydas' }],
      sharedWith: ['c-1'],
    },
  });
  server.assign
    .mockReset()
    .mockResolvedValue({ assignedPlayers: 0, panel: null });
});

describe('the Repertoire screen page (R-226)', () => {
  it('shows the repertoire the path names, with its sharing', async () => {
    renderIn(await page(ID));
    expect(server.data).toHaveBeenCalledWith(ID);
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

  it('is a 404 wherever the loader says so, reading no assignment', async () => {
    server.data.mockRejectedValue(new Error(NOT_FOUND));
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
