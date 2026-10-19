import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import type { CreateInviteState, RevokeInviteState } from './actions';
import { InvitesSection, type CoachInviteRow } from './invites-section';

const server = vi.hoisted(() => ({
  create:
    vi.fn<
      (
        previous: CreateInviteState,
        form: FormData,
      ) => Promise<CreateInviteState>
    >(),
  revoke:
    vi.fn<
      (
        previous: RevokeInviteState,
        form: FormData,
      ) => Promise<RevokeInviteState>
    >(),
}));

vi.mock('./actions', () => ({
  createInviteAction: server.create,
  revokeInviteAction: server.revoke,
}));

const i = MESSAGES.lt.coach.invites;

const GROUPS = [
  { id: 'g-1', name: 'Sekmadienio grupė' },
  { id: 'g-2', name: 'Šeštadienio grupė' },
];

// 21:30 UTC on the 24th is already the 25th in Vilnius (UTC+3).
const EXPIRES = new Date('2026-10-24T21:30:00Z');
const vilnius = (locale: string) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'Europe/Vilnius',
  }).format(EXPIRES);

const INVITES: readonly CoachInviteRow[] = [
  {
    id: 'i-1',
    kind: 'group',
    groupName: 'Šeštadienio grupė',
    state: 'active',
    expiresAt: EXPIRES,
  },
  {
    id: 'i-2',
    kind: 'personal',
    groupName: null,
    state: 'used',
    expiresAt: EXPIRES,
  },
  {
    id: 'i-3',
    kind: 'personal',
    groupName: null,
    state: 'revoked',
    expiresAt: EXPIRES,
  },
  {
    id: 'i-4',
    kind: 'personal',
    groupName: null,
    state: 'expired',
    expiresAt: EXPIRES,
  },
];

const LINK = `http://localhost:3000/k/${'A'.repeat(43)}`;

function renderSection(
  invites: readonly CoachInviteRow[] = [],
  locale: 'lt' | 'en' = 'lt',
): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <InvitesSection groups={GROUPS} invites={invites} />
    </NextIntlClientProvider>,
  );
}

const createButton = () => screen.getByRole('button', { name: i.create });
const sentForm = () =>
  Object.fromEntries(server.create.mock.lastCall?.[1].entries() ?? []);
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  server.create.mockReset().mockResolvedValue({ link: LINK });
  server.revoke.mockReset().mockResolvedValue({});
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('InvitesSection: making an invite (R-98, R-110)', () => {
  it('makes a personal invite with no group by default', async () => {
    renderSection();
    expect(
      screen.getByRole('heading', { level: 2, name: i.title }),
    ).toBeDefined();
    expect(screen.getByText(i.intro)).toBeDefined();
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: i.personal }).checked,
    ).toBe(true);
    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual([i.noGroup, 'Sekmadienio grupė', 'Šeštadienio grupė']);
    fireEvent.click(createButton());
    await waitFor(() => {
      expect(server.create).toHaveBeenCalledTimes(1);
    });
    expect(sentForm()).toEqual({ kind: 'personal', groupId: '' });
  });

  it('makes a group invite for the chosen group', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('radio', { name: i.group }));
    fireEvent.change(screen.getByLabelText(i.groupLabel), {
      target: { value: 'g-2' },
    });
    fireEvent.click(createButton());
    await waitFor(() => {
      expect(server.create).toHaveBeenCalledTimes(1);
    });
    expect(sentForm()).toEqual({ kind: 'group', groupId: 'g-2' });
  });

  it('shows the new link once, ready to copy (plan decision 5)', async () => {
    renderSection();
    fireEvent.click(createButton());
    const field = await screen.findByLabelText<HTMLInputElement>(i.link);
    expect(field.value).toBe(LINK);
    expect(field.readOnly).toBe(true);
    expect(screen.getByText(i.linkOnce)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: i.copy }));
    await waitFor(() => {
      expect(screen.getByText(i.copied)).toBeDefined();
    });
    expect(writeText).toHaveBeenCalledWith(LINK);
  });

  it('shows a refusal and keeps the choices made', async () => {
    server.create.mockResolvedValue({ refusal: 'invite.groupRequired' });
    renderSection();
    fireEvent.click(screen.getByRole('radio', { name: i.group }));
    fireEvent.click(createButton());
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('status')
          .some(
            (line) => line.textContent === MESSAGES.lt.invite.groupRequired,
          ),
      ).toBe(true);
    });
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: i.group }).checked,
    ).toBe(true);
    expect(screen.queryByLabelText(i.link)).toBeNull();
  });

  it('names the open-invite limit when it is reached (R-114)', async () => {
    server.create.mockResolvedValue({ refusal: 'coach.inviteLimit' });
    renderSection();
    fireEvent.click(createButton());
    const said = MESSAGES.lt.coach.inviteLimit.replace('{limit}', '50');
    await waitFor(() => {
      expect(
        screen.getAllByRole('status').some((line) => line.textContent === said),
      ).toBe(true);
    });
    // The limit comes from OPEN_INVITE_LIMIT, not from the catalogue text.
    expect(MESSAGES.lt.coach.inviteLimit).toContain('{limit}');
    expect(MESSAGES.en.coach.inviteLimit).toContain('{limit}');
  });
});

describe('InvitesSection: the invite list', () => {
  it('says when there are no invites', () => {
    renderSection();
    expect(screen.getByText(i.empty)).toBeDefined();
  });

  it('shows each invite’s kind, group and state, and when an active one expires, in Vilnius time', () => {
    renderSection(INVITES);
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      `${i.group}Grupė: Šeštadienio grupė${i.state.active}Galioja iki ${vilnius('lt')}${i.revoke}`,
      `${i.personal}${i.state.used}`,
      `${i.personal}${i.state.revoked}`,
      `${i.personal}${i.state.expired}`,
    ]);
  });

  it('revokes an active invite', async () => {
    renderSection(INVITES);
    expect(screen.getAllByRole('button', { name: i.revoke })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: i.revoke }));
    await waitFor(() => {
      expect(server.revoke).toHaveBeenCalledTimes(1);
    });
    expect(
      Object.fromEntries(server.revoke.mock.lastCall?.[1].entries() ?? []),
    ).toEqual({ inviteId: 'i-1' });
  });

  it('says so when an invite can no longer be revoked', async () => {
    server.revoke.mockResolvedValue({ refusal: 'invite.invalid' });
    renderSection(INVITES);
    fireEvent.click(screen.getByRole('button', { name: i.revoke }));
    await waitFor(() => {
      expect(
        screen.getAllByRole('status').map((line) => line.textContent),
      ).toContain(i.revokeInvalid);
    });
  });

  it('speaks English on the English page', () => {
    renderSection(INVITES.slice(0, 1), 'en');
    expect(screen.getByText(`Valid until ${vilnius('en')}`)).toBeDefined();
  });
});
