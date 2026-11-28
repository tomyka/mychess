import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../i18n/catalogue';
import { DANGER_OUTLINE_BUTTON, SECONDARY_BUTTON } from '../../../buttons';
import type { AssignPanelData } from '../../../../server/coach-assignments';
import type { RepertoireSharing } from '../../../../server/repertoires';
import type { RenameState } from '../actions';
import { ManageScreen } from './manage-screen';

const server = vi.hoisted(() => ({
  rename:
    vi.fn<(previous: RenameState, form: FormData) => Promise<RenameState>>(),
  remove: vi.fn(),
}));

vi.mock('../actions', () => ({
  renameRepertoireAction: server.rename,
  deleteRepertoireAction: server.remove,
}));

vi.mock('../sharing-actions', () => ({ setSharesAction: vi.fn() }));

vi.mock('../assign-actions', () => ({
  assignAction: vi.fn(),
  unassignAction: vi.fn(),
  setDeadlineAction: vi.fn(),
  clearDeadlineAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/repertoires/r-1/manage',
}));

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const m = MESSAGES.repertoires.manage;

const SHARED: RepertoireSharing = {
  coaches: [{ id: 'c-1', displayName: 'Dovydas' }],
  sharedWith: [],
};

const PANEL: AssignPanelData = {
  players: [{ id: 'egle', displayName: 'Eglė', viaGroups: [] }],
  groups: [],
  assignments: [
    {
      id: 'a-rokas',
      target: { kind: 'player', id: 'rokas', name: 'Rokas' },
      deadline: null,
      players: [
        {
          playerId: 'rokas',
          displayName: 'Rokas',
          deadline: null,
          status: {
            deadline: null,
            paused: false,
            forked: false,
            overdue: false,
            done: false,
          },
        },
      ],
    },
  ],
  today: '2026-11-26',
  standings: new Map([
    [
      'rokas',
      {
        standing: {
          counts: { notStarted: 3, skipped: 0, due: 0, learned: 1 },
          mastered: false,
        },
        status: {
          deadline: null,
          paused: false,
          forked: false,
          overdue: false,
          done: false,
        },
      },
    ],
  ]),
};

function renderScreen(panel: AssignPanelData | null = null): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <ManageScreen
        repertoire={{ id: ID, name: 'Londono sistema' }}
        sharing={SHARED}
        assignedPlayers={panel === null ? 0 : 1}
        assignPanel={panel}
      />
    </NextIntlClientProvider>,
  );
}

/** The page's sections, by their headings, in order. */
const sectionTitles = (): string[] =>
  screen
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent);

beforeEach(() => {
  server.rename.mockReset().mockResolvedValue({ saved: true });
  server.remove.mockReset().mockResolvedValue({});
});

describe('the Repertoire screen (R-226)', () => {
  it('is titled by the repertoire, with the way back to it', () => {
    renderScreen();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: 'Back to Londono sistema' })
        .getAttribute('href'),
    ).toBe(`/repertoires/${ID}`);
  });

  it('offers rename, the PGN download and adding from PGN first', () => {
    renderScreen();
    const own = screen.getByRole('region', { name: m.section });
    expect(within(own).getByRole('button', { name: m.rename })).toBeDefined();
    const download = within(own).getByRole('link', { name: m.download });
    expect(download.getAttribute('href')).toBe(`/api/repertoires/${ID}/export`);
    expect(download.hasAttribute('download')).toBe(true);
    expect(
      within(own)
        .getByRole('link', { name: m.importInto })
        .getAttribute('href'),
    ).toBe(`/repertoires/import?i=${ID}`);
  });

  it('then sharing, with its status as text, and delete last', () => {
    renderScreen();
    expect(sectionTitles()).toEqual([
      m.section,
      MESSAGES.share.title,
      m.deleteTitle,
    ]);
    const share = screen.getByRole('region', { name: MESSAGES.share.title });
    expect(within(share).getByRole('status').textContent).toBe(
      MESSAGES.share.notShared,
    );
  });

  it('has Assigned to in Coach mode, before delete, with each player’s progress (R-225)', () => {
    renderScreen(PANEL);
    expect(sectionTitles()).toEqual([
      m.section,
      MESSAGES.share.title,
      MESSAGES.assignment.panel.list,
      m.deleteTitle,
    ]);
    const rokas = screen.getByRole('listitem', { name: 'Rokas' });
    expect(within(rokas).getByText('25% learned')).toBeDefined();
  });

  it('renames in place and says so', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: m.rename }));
    const field = screen.getByLabelText<HTMLInputElement>(m.renameLabel);
    expect(field.value).toBe('Londono sistema');
    fireEvent.change(field, { target: { value: 'Londonas' } });
    const own = screen.getByRole('region', { name: m.section });
    fireEvent.click(within(own).getByRole('button', { name: m.renameSubmit }));
    expect(await screen.findByText(m.renamed)).toBeDefined();
    expect(screen.queryByLabelText(m.renameLabel)).toBeNull();
    expect(server.rename.mock.lastCall?.[1].get('name')).toBe('Londonas');
  });

  it('cancels a rename back to the Rename button', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: m.rename }));
    fireEvent.click(screen.getByRole('button', { name: m.renameCancel }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: m.rename }),
    );
  });

  it('deletes only after the second step, in its own danger section', async () => {
    renderScreen(PANEL);
    const danger = screen.getByRole('region', { name: m.deleteTitle });
    fireEvent.click(within(danger).getByRole('button', { name: m.delete }));
    expect(
      within(danger).getByText(
        m.deleteQuestion.replace('{name}', 'Londono sistema'),
      ),
    ).toBeDefined();
    // The player who has it by assignment is told about (R-131).
    expect(
      within(danger).getByText(
        '1 player has this repertoire and has 30 days to keep their own copy.',
      ),
    ).toBeDefined();
    expect(server.remove).not.toHaveBeenCalled();
    fireEvent.click(
      within(danger).getByRole('button', { name: m.deleteConfirm }),
    );
    await waitFor(() => {
      expect(server.remove).toHaveBeenCalledTimes(1);
    });
  });

  it('draws Delete as the outlined danger button, never the secondary one recoloured', () => {
    renderScreen();
    const danger = screen.getByRole('region', { name: m.deleteTitle });
    const remove = within(danger).getByRole('button', { name: m.delete });
    expect(remove.className).toContain(DANGER_OUTLINE_BUTTON);
    expect(remove.className).not.toContain(SECONDARY_BUTTON);
  });

  it('cancels a delete back to the Delete button', () => {
    renderScreen();
    const danger = screen.getByRole('region', { name: m.deleteTitle });
    fireEvent.click(within(danger).getByRole('button', { name: m.delete }));
    fireEvent.click(
      within(danger).getByRole('button', { name: m.deleteCancel }),
    );
    expect(document.activeElement).toBe(
      within(danger).getByRole('button', { name: m.delete }),
    );
  });
});
