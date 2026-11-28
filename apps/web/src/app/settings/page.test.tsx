import type { PlayerAssignment } from '@mychess/db';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MESSAGES } from '../../i18n/catalogue';
import SettingsPage from './page';

// What the mocked server knows: the Google pair and the account's links.
const server = vi.hoisted(() => {
  const state: {
    google: { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string };
    links: { id: string; provider: 'google' | 'lichess' }[];
    lichessUnlinked: boolean;
    fresh: boolean;
    coachSince: Date | null;
    coaches: {
      id: string;
      displayName: string;
      linkedAt: Date;
      groups: { id: string; name: string }[];
    }[];
    coachesOf: string[];
    assignments: PlayerAssignment[];
    assignmentsOf: string[];
    trainingOf: string[];
  } = {
    google: { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' },
    links: [],
    lichessUnlinked: false,
    fresh: true,
    coachSince: null,
    coaches: [],
    coachesOf: [],
    assignments: [],
    assignmentsOf: [],
    trainingOf: [],
  };
  return state;
});

// requireOnboarded never returns for a signed-out or new account;
// session-helpers.test.ts covers that.
vi.mock('../../server/session', () => ({
  hasFreshSession: () => Promise.resolve(server.fresh),
  requireOnboarded: () =>
    Promise.resolve({
      id: 'a1',
      email: 'ruta@example.lt',
      displayName: 'Rūta Jonaitė',
      entitlement: 'free',
      admin: false,
      disabledAt: null,
      onboardedAt: new Date(),
      coachSince: server.coachSince,
      createdAt: new Date(),
    }),
}));

vi.mock('../../server/provider-links', () => ({
  linkedProviders: () => Promise.resolve(server.links),
}));

vi.mock('../../server/lichess-unlinked', () => ({
  showLichessUnlinked: (accountId: string) =>
    Promise.resolve(accountId === 'a1' && server.lichessUnlinked),
}));

vi.mock('../../server/env', async (original) => ({
  ...(await original<typeof import('../../server/env')>()),
  readWebEnv: () => server.google,
}));

vi.mock('../../lib/auth-client', () => ({
  authClient: { linkSocial: vi.fn(), unlinkAccount: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// The delete control as it is, keeping the account each render hands it:
// a client component, so whatever it is given reaches the browser.
const handed = vi.hoisted(() => {
  const state: { accounts: unknown[] } = { accounts: [] };
  return state;
});
vi.mock('../delete-account-control', async (original) => {
  const actual = await original<typeof import('../delete-account-control')>();
  return {
    ...actual,
    DeleteAccountControl: (
      props: Parameters<typeof actual.DeleteAccountControl>[0],
    ) => {
      handed.accounts.push(props.account);
      return actual.DeleteAccountControl(props);
    },
  };
});

vi.mock('../../server/db', () => ({ getDb: () => ({}) }));

// The player's coaches, as the repository lists them for the account asked.
vi.mock('@mychess/db', async (original) => ({
  ...(await original<typeof import('@mychess/db')>()),
  playerCoaches: (_db: unknown, playerId: string) => {
    server.coachesOf.push(playerId);
    return Promise.resolve(server.coaches);
  },
  // The player's live assignments, as the repository lists them (R-237).
  playerAssignments: (_db: unknown, playerId: string) => {
    server.assignmentsOf.push(playerId);
    return Promise.resolve(server.assignments);
  },
  // The account's training limits, as the repository reads them.
  trainingSettings: (_db: unknown, playerId: string) => {
    server.trainingOf.push(playerId);
    return Promise.resolve({
      sessionSize: 30,
      newPerDay: 5,
      learnArrows: false,
    });
  },
}));

vi.mock('./coaching-actions', () => ({
  startCoachingAction: vi.fn(),
  stopCoachingAction: vi.fn(),
  unlinkCoachAction: vi.fn(),
  leaveGroupAction: vi.fn(),
}));

vi.mock('./actions', () => ({
  updateProfileAction: vi.fn(),
  deleteAccountAction: vi.fn(),
  dismissLichessUnlinkedAction: vi.fn(),
  updateTrainingSettingsAction: vi.fn(),
}));

type Search = Record<string, string | string[] | undefined>;

const page = (search: Search = {}): Promise<JSX.Element> =>
  SettingsPage({ searchParams: Promise.resolve(search) });

async function renderPage(search: Search = {}): Promise<void> {
  const element = await page(search);
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {element}
    </NextIntlClientProvider>,
  );
}

const s = MESSAGES.settings;
const provider = (template: string, name: string) =>
  template.replace('{provider}', name);

/** Presses Delete account…; the delete sheet it opens. */
const openDelete = (): HTMLElement => {
  fireEvent.click(screen.getByRole('button', { name: s.delete.open }));
  return screen.getByRole('dialog', { name: s.delete.title });
};

beforeEach(() => {
  server.google = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' };
  server.links = [];
  server.lichessUnlinked = false;
  server.fresh = true;
  server.coachSince = null;
  server.coaches = [];
  server.coachesOf = [];
  server.assignments = [];
  server.assignmentsOf = [];
  server.trainingOf = [];
});

describe('the settings page', () => {
  it('has its cards most used first: Training, My coaches, Account, Coach mode, Your data (#381 part 6)', async () => {
    await renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: s.title }),
    ).toBeDefined();
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      MESSAGES.training.settings.title,
      s.myCoaches.title,
      s.account.title,
      s.coachMode.title,
      s.export.title,
    ]);
  });

  it('holds the display name and the sign-in methods in Account', async () => {
    await renderPage();
    const account = screen.getByRole('region', { name: s.account.title });
    expect(
      within(account).getByLabelText<HTMLInputElement>(s.profile.displayName)
        .value,
    ).toBe('Rūta Jonaitė');
    expect(
      within(account).getByRole('heading', {
        level: 3,
        name: s.providers.title,
      }),
    ).toBeDefined();
  });

  it('holds Download my data and Delete account… in Your data', async () => {
    await renderPage();
    const data = screen.getByRole('region', { name: s.export.title });
    expect(
      within(data)
        .getByRole('link', { name: s.export.download })
        .getAttribute('href'),
    ).toBe('/api/account/export');
    expect(
      within(data).getByRole('button', { name: s.delete.open }),
    ).toBeDefined();
  });

  it('has no primary button: every Save is secondary', async () => {
    await renderPage();
    for (const button of screen.getAllByRole('button'))
      expect(button.className.split(' ')).not.toContain('bg-accent');
  });

  it.each([
    ['coach', 'Back to Coach', '/coach'],
    ['opponents', 'Back to Opponents', '/fide'],
    [undefined, 'Back to Today', '/'],
    ['https://evil.example', 'Back to Today', '/'],
  ])(
    'goes back to the tab it was opened from (from=%s)',
    async (from, name, href) => {
      await renderPage(from === undefined ? {} : { from });
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(
        href,
      );
    },
  );

  it("shows the session account's training settings (R-62, R-146, R-205)", async () => {
    await renderPage();
    const t = MESSAGES.training.settings;
    expect(server.trainingOf).toEqual(['a1']);
    expect(
      screen.getByLabelText<HTMLInputElement>(t.sessionSizeLabel).value,
    ).toBe('30');
    expect(
      screen.getByLabelText<HTMLInputElement>(t.newPerDayLabel).value,
    ).toBe('5');
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', {
        name: t.learnArrowsLabel,
      }).checked,
    ).toBe(false);
  });

  it('shows the account’s links and the error code a link came back with', async () => {
    server.links = [{ id: 'pa-1', provider: 'lichess' }];
    await renderPage({ error: ['account_already_linked_to_different_user'] });
    expect(
      screen.getByRole('button', {
        name: provider(s.providers.unlink, 'Lichess'),
      }),
    ).toBeDefined();
    expect(
      screen
        .getAllByRole('status')
        .some((line) => line.textContent === s.providers.error.linkedElsewhere),
    ).toBe(true);
  });

  it('offers no Google when its secret is missing', async () => {
    server.google = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: '' };
    await renderPage();
    expect(
      screen.queryByRole('button', {
        name: provider(s.providers.link, 'Google'),
      }),
    ).toBeNull();
    expect(
      screen.getByRole('button', {
        name: provider(s.providers.link, 'Lichess'),
      }),
    ).toBeDefined();
  });

  it('says why Lichess is gone when proving the email ended its link (R-90)', async () => {
    server.lichessUnlinked = true;
    await renderPage();
    const providers = screen.getByRole('region', { name: s.providers.title });
    expect(within(providers).getByRole('note').textContent).toContain(
      s.providers.lichessUnlinked,
    );
  });

  it('hands the delete control only what deciding a deletion needs', async () => {
    handed.accounts = [];
    await renderPage();
    const [account] = handed.accounts;
    expect(Object.keys(z.object({}).loose().parse(account)).sort()).toEqual([
      'displayName',
      'email',
      'onboardedAt',
    ]);
    expect(account).toMatchObject({
      displayName: 'Rūta Jonaitė',
      email: 'ruta@example.lt',
    });
  });

  it('asks a session older than a day to sign in again instead of offering the export (R-95)', async () => {
    server.fresh = false;
    await renderPage();
    const data = screen.getByRole('region', { name: s.export.title });
    expect(
      within(data).queryByRole('link', { name: s.export.download }),
    ).toBeNull();
    expect(within(data).getByRole('note').textContent).toBe(s.export.notFresh);
    const deletion = openDelete();
    expect(within(deletion).queryByRole('link')).toBeNull();
    expect(within(deletion).getByRole('note').textContent).toBe(
      s.export.notFresh,
    );
  });

  it('links the export from the delete sheet for a fresh session', async () => {
    await renderPage();
    const deletion = openDelete();
    expect(within(deletion).getByRole('link').getAttribute('href')).toBe(
      '/api/account/export',
    );
  });

  it('offers Delete account… in Your data, opening the delete sheet (#381 part 6)', async () => {
    await renderPage();
    const data = screen.getByRole('region', { name: s.export.title });
    expect(within(data).getByRole('button', { name: s.delete.open })).toBe(
      screen.getByRole('button', { name: s.delete.open }),
    );
    expect(
      within(openDelete()).getByRole('button', { name: s.delete.confirm }),
    ).toBeDefined();
  });

  it('offers to switch Coach mode on for an account that has not', async () => {
    await renderPage();
    const coachMode = screen.getByRole('region', { name: s.coachMode.title });
    expect(within(coachMode).getByText(s.coachMode.intro)).toBeDefined();
    expect(
      within(coachMode).getByRole('button', { name: s.coachMode.switchOn }),
    ).toBeDefined();
  });

  it('offers to switch Coach mode off for a coach (R-11)', async () => {
    server.coachSince = new Date('2026-10-17T08:00:00Z');
    await renderPage();
    const coachMode = screen.getByRole('region', { name: s.coachMode.title });
    expect(
      within(coachMode).getByRole('button', { name: s.coachMode.switchOff }),
    ).toBeDefined();
  });

  it("lists the session account's own coaches with what each assigns and the groups (R-237)", async () => {
    server.coaches = [
      {
        id: 'c-1',
        displayName: 'Jonas',
        linkedAt: new Date(),
        groups: [{ id: 'g-1', name: 'Šeštadienio grupė' }],
      },
    ];
    server.assignments = [
      {
        repertoireId: 'r-1',
        name: 'Caro-Kann basics',
        side: 'black',
        chapters: 1,
        moves: 12,
        coachId: 'c-1',
        coachName: 'Jonas',
        deadline: null,
        paused: false,
        done: false,
        badges: { overdue: false, paused: false, updated: false },
      },
    ];
    await renderPage();
    expect(server.coachesOf).toEqual(['a1']);
    expect(server.assignmentsOf).toEqual(['a1']);
    const coaches = screen.getByRole('region', { name: s.myCoaches.title });
    expect(coaches.id).toBe('coaches');
    expect(
      within(coaches).getByRole('heading', { level: 3, name: 'Jonas' }),
    ).toBeDefined();
    expect(within(coaches).getByText('Caro-Kann basics')).toBeDefined();
    expect(within(coaches).getByText('No deadline')).toBeDefined();
    expect(within(coaches).getByText('Šeštadienio grupė')).toBeDefined();
  });

  it('no longer says an invite was accepted: Today does (R-234)', async () => {
    server.coaches = [
      { id: 'c-1', displayName: 'Jonas', linkedAt: new Date(), groups: [] },
    ];
    await renderPage({ coach: 'c-1' });
    const coaches = screen.getByRole('region', { name: s.myCoaches.title });
    expect(within(coaches).queryByRole('status')).toBeNull();
  });

  it('says nothing about Lichess otherwise', async () => {
    await renderPage();
    expect(screen.queryByRole('note')).toBeNull();
  });
});
