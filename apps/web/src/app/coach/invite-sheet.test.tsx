import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { PersonalInvite } from '../../server/coach-pages';
import type { CreateInviteState, RevokeInviteState } from './actions';
import { InviteSheet } from './invite-sheet';

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

const s = MESSAGES.coach.inviteSheet;
const i = MESSAGES.coach.invites;

const TODAY = '2026-11-27';
// 22:30 UTC on 3 December is already 4 December in Vilnius (UTC+2).
const EXPIRES = new Date('2026-12-03T22:30:00Z');
const MADE = new Date('2026-11-20T09:00:00Z');
const LINK = `http://localhost:3000/invite/${'A'.repeat(43)}`;

const INVITES: readonly PersonalInvite[] = [
  { id: 'i-1', createdAt: MADE, expiresAt: EXPIRES },
  {
    id: 'i-2',
    createdAt: new Date('2026-11-25T09:00:00Z'),
    expiresAt: new Date('2026-12-02T09:00:00Z'),
  },
];

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  server.create
    .mockReset()
    .mockResolvedValue({ link: LINK, expiresAt: EXPIRES });
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

function renderSheet(invites: readonly PersonalInvite[] = []): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <InviteSheet invites={invites} today={TODAY} />
    </NextIntlClientProvider>,
  );
}

const openButton = () => screen.getByRole('button', { name: s.title });

/**
 * Opens the sheet from its button and returns both. The button is clicked
 * without taking focus, as in Safari, and focus then moves into the sheet.
 */
function openSheet(): { opener: HTMLElement; sheet: HTMLElement } {
  const opener = openButton();
  fireEvent.click(opener);
  const sheet = screen.getByRole('dialog', { name: s.title });
  within(sheet).getByRole('button', { name: s.create }).focus();
  return { opener, sheet };
}

/** Escape, as the browser turns it into the dialog's cancel. */
const escape = (sheet: HTMLElement): void => {
  fireEvent(sheet, new Event('cancel', { cancelable: true }));
};

const statusTexts = (): (string | null)[] =>
  screen.getAllByRole('status').map((line) => line.textContent);

describe('InviteSheet: opening and closing (R-232)', () => {
  it('opens a dialog named Invite a player, with what a player gets and Create link', () => {
    renderSheet();
    expect(screen.queryByRole('dialog')).toBeNull();
    const { sheet } = openSheet();
    expect(within(sheet).getByText(s.intro)).toBeDefined();
    expect(within(sheet).getByRole('button', { name: s.create })).toBeDefined();
  });

  it('closes on Escape and gives focus back to the button', () => {
    renderSheet();
    const { opener, sheet } = openSheet();
    escape(sheet);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes from its Close button, for a phone without Escape', () => {
    renderSheet();
    const { opener, sheet } = openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: s.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('InviteSheet: creating a link (R-98, R-99)', () => {
  it('makes a personal invite and shows its link once, until when it works, with Copy', async () => {
    renderSheet();
    const { sheet } = openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: s.create }));
    const field = await within(sheet).findByRole<HTMLInputElement>('textbox', {
      name: i.link,
    });
    expect(
      Object.fromEntries(server.create.mock.lastCall?.[1].entries() ?? []),
    ).toEqual({ kind: 'personal' });
    expect(field.value).toBe(LINK);
    expect(field.readOnly).toBe(true);
    // The date in Vilnius, the year left out as it is this year's.
    expect(
      within(sheet).getByText(
        'This link is shown once and works for one player until Dec 4.',
      ),
    ).toBeDefined();
    expect(within(sheet).queryByText(i.linkOnce)).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: i.copy }));
    await waitFor(() => {
      expect(within(sheet).getByText(i.copied)).toBeDefined();
    });
    expect(writeText).toHaveBeenCalledWith(LINK);
  });

  it('forgets the link once closed: it is shown once', async () => {
    renderSheet();
    const { sheet } = openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: s.create }));
    await within(sheet).findByRole('textbox', { name: i.link });
    escape(sheet);
    openSheet();
    expect(screen.queryByRole('textbox', { name: i.link })).toBeNull();
  });

  it('names the open-invite limit in its status line (R-114)', async () => {
    server.create.mockResolvedValue({ refusal: 'coach.inviteLimit' });
    renderSheet();
    const { sheet } = openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: s.create }));
    const said = MESSAGES.coach.inviteLimit.replace('{limit}', '50');
    await waitFor(() => {
      expect(statusTexts()).toContain(said);
    });
    expect(within(sheet).queryByRole('textbox', { name: i.link })).toBeNull();
  });

  it('says Coach mode is off when it went off meanwhile', async () => {
    server.create.mockResolvedValue({ refusal: 'coach.notCoach' });
    renderSheet();
    const { sheet } = openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: s.create }));
    await waitFor(() => {
      expect(statusTexts()).toContain(MESSAGES.coach.notCoach);
    });
  });
});

describe('InviteSheet: open personal invites', () => {
  it('says when there is none', () => {
    renderSheet();
    const { sheet } = openSheet();
    expect(within(sheet).getByText(i.empty)).toBeDefined();
  });

  it('lists each with when it was made and when it expires, never its link', () => {
    renderSheet(INVITES);
    const { sheet } = openSheet();
    const list = within(sheet).getByRole('list', { name: s.openTitle });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.querySelector('p')?.textContent),
    ).toEqual(['made Nov 20 · expires Dec 4', 'made Nov 25 · expires Dec 2']);
    expect(sheet.textContent).not.toContain('/invite/');
  });

  it('asks before revoking, then revokes that invite', async () => {
    renderSheet(INVITES);
    const { sheet } = openSheet();
    const [first] = within(sheet).getAllByRole('button', { name: i.revoke });
    if (first === undefined) throw new Error('no Revoke');
    // The error tone: Revoke takes the link away.
    expect(first.className).toContain('text-error');
    fireEvent.click(first);
    expect(server.revoke).not.toHaveBeenCalled();
    expect(within(sheet).getByText(s.revokeConfirm)).toBeDefined();
    fireEvent.click(
      within(sheet).getByRole('button', { name: s.confirmRevoke }),
    );
    await waitFor(() => {
      expect(server.revoke).toHaveBeenCalledTimes(1);
    });
    expect(
      Object.fromEntries(server.revoke.mock.lastCall?.[1].entries() ?? []),
    ).toEqual({ inviteId: 'i-1' });
  });

  it('says so when the invite can no longer be revoked', async () => {
    server.revoke.mockResolvedValue({ refusal: 'invite.invalid' });
    renderSheet(INVITES);
    const { sheet } = openSheet();
    const [first] = within(sheet).getAllByRole('button', { name: i.revoke });
    if (first === undefined) throw new Error('no Revoke');
    fireEvent.click(first);
    fireEvent.click(
      within(sheet).getByRole('button', { name: s.confirmRevoke }),
    );
    await waitFor(() => {
      expect(statusTexts()).toContain(i.revokeInvalid);
    });
  });
});
