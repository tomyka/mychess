import type { InviteAssignment } from '@mychess/db';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/catalogue';
import type { AcceptState } from './actions';
import { InviteView, type InvitePreviewResult } from './invite-view';

const server = vi.hoisted(() => ({
  accept:
    vi.fn<(previous: AcceptState, form: FormData) => Promise<AcceptState>>(),
}));

vi.mock('./actions', () => ({ acceptInviteAction: server.accept }));

const i = MESSAGES.invite;
const TOKEN = 'A'.repeat(42) + '_';
const TODAY = '2026-11-28';

/** An invite open to accept, from Rimantas V., to `groupName` if any. */
const active = (
  groupName: string | null,
  assignments: readonly InviteAssignment[] = [],
): InvitePreviewResult => ({
  ok: true,
  value: {
    state: 'active',
    coachDisplayName: 'Rimantas V.',
    groupName,
    kind: groupName === null ? 'personal' : 'group',
    assignments,
  },
});

const refused = (
  reason: Extract<InvitePreviewResult, { ok: false }>['refusal']['reason'],
): InvitePreviewResult => ({ ok: false, refusal: { reason } });

function renderView(preview: InvitePreviewResult): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <InviteView token={TOKEN} preview={preview} today={TODAY} />
    </NextIntlClientProvider>,
  );
}

const h1 = (): HTMLElement => screen.getByRole('heading', { level: 1 });
const link = (name: string): string | null =>
  screen.getByRole('link', { name }).getAttribute('href');

beforeEach(() => {
  server.accept.mockReset().mockResolvedValue({});
});

describe('InviteView, an invite open to accept', () => {
  it('heads a personal invite with its coach, in the entry frame', () => {
    renderView(active(null));
    expect(h1().textContent).toBe('Rimantas V. invites you');
    expect(
      within(screen.getByRole('main')).getByRole('heading', { level: 1 }),
    ).toBeDefined();
    expect(link('MyChess')).toBe('/');
  });

  it('lists what the coach will see, what stays private, and unlinking (R-39)', () => {
    renderView(active(null));
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      i.privacy.sees,
      i.privacy.private,
      i.privacy.unlink,
    ]);
    expect(i.privacy.sees).toContain('repertoires they assign you');
    expect(i.privacy.sees).toContain('imported games');
    expect(i.privacy.private).toContain('private unless you share them');
    expect(i.privacy.unlink).toContain('Settings');
  });

  it('offers Accept and Not now, back to Today, and no Comes with for a personal invite', () => {
    renderView(active(null));
    expect(screen.getByRole('button', { name: i.accept })).toBeDefined();
    expect(link(i.notNow)).toBe('/');
    expect(screen.queryByText(i.comesWith)).toBeNull();
  });

  it('heads a group invite with its coach and group', () => {
    renderView(active('Juniors 2026'));
    expect(h1().textContent).toBe('Rimantas V. invites you to Juniors 2026');
  });

  it('lists what a group invite comes with, each with its deadline (R-236)', () => {
    renderView(
      active('Juniors 2026', [
        { repertoireName: 'Caro-Kann basics', deadline: '2026-12-20' },
        { repertoireName: 'Alapin', deadline: null },
      ]),
    );
    const comesWith = screen.getByRole('region', { name: i.comesWith });
    expect(
      within(comesWith)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Caro-Kann basics · deadline Dec 20', 'Alapin · No deadline']);
  });

  // Lead decisions, the R-236 reading: any invite that joins a group on
  // Accept lists that group's assignments, a personal one naming it too.
  it('heads a personal invite naming a group with the group, and lists what it comes with (R-110)', () => {
    renderView({
      ok: true,
      value: {
        state: 'active',
        coachDisplayName: 'Rimantas V.',
        groupName: 'Juniors 2026',
        kind: 'personal',
        assignments: [{ repertoireName: 'Alapin', deadline: null }],
      },
    });
    expect(h1().textContent).toBe('Rimantas V. invites you to Juniors 2026');
    const comesWith = screen.getByRole('region', { name: i.comesWith });
    expect(within(comesWith).getByRole('listitem').textContent).toBe(
      'Alapin · No deadline',
    );
  });

  it('makes Accept the primary action and Not now a quiet link', () => {
    renderView(active(null));
    expect(
      screen.getByRole('button', { name: i.accept }).className.split(' '),
    ).toContain('bg-accent');
    const notNow = screen.getByRole('link', { name: i.notNow });
    expect(notNow.className.split(' ')).toContain('text-fg-muted');
    expect(notNow.className.split(' ')).not.toContain('bg-accent');
  });

  it('says nothing of what a group comes with when it has nothing assigned', () => {
    renderView(active('Juniors 2026'));
    expect(screen.queryByText(i.comesWith)).toBeNull();
  });

  it('accepts by posting only the token (the account is the session’s)', async () => {
    renderView(active('Juniors 2026'));
    fireEvent.click(screen.getByRole('button', { name: i.accept }));
    await waitFor(() => {
      expect(server.accept).toHaveBeenCalledTimes(1);
    });
    expect(
      Object.fromEntries(server.accept.mock.lastCall?.[1].entries() ?? []),
    ).toEqual({ token: TOKEN });
  });

  it('shows a refusal the accept met, in place of the confirm screen', async () => {
    server.accept.mockResolvedValue({ refusal: 'invite.invalid' });
    renderView(active('Juniors 2026'));
    fireEvent.click(screen.getByRole('button', { name: i.accept }));
    expect(await screen.findByText(i.invalid)).toBeDefined();
    expect(h1().textContent).toBe(i.invalidTitle);
    expect(screen.queryByRole('button', { name: i.accept })).toBeNull();
  });
});

describe('InviteView, an invite this account already accepted (#329)', () => {
  it('says it is linked with the coach, and goes to Today', () => {
    renderView({
      ok: true,
      value: {
        state: 'accepted',
        coachDisplayName: 'Rimantas V.',
        groupName: 'Juniors 2026',
      },
    });
    expect(h1().textContent).toBe('You are linked with Rimantas V.');
    expect(link(MESSAGES.nav.goToday)).toBe('/');
    expect(
      screen
        .getByRole('link', { name: MESSAGES.nav.goToday })
        .className.split(' '),
    ).toContain('bg-accent');
    expect(screen.queryByRole('button', { name: i.accept })).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('InviteView, an invite that cannot be accepted', () => {
  it('says a link that is not valid, in the error tone, with a way to Today', () => {
    renderView(refused('invite.invalid'));
    expect(h1().textContent).toBe(i.invalidTitle);
    expect(i.invalidTitle).toBe('This invite link is not valid');
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Ask your coach for a new link.');
    expect(status.className).toContain('text-error');
    expect(link(MESSAGES.nav.goToday)).toBe('/');
  });

  it('says it is your own invite, as information, with a way back to Coach', () => {
    renderView(refused('invite.ownInvite'));
    expect(h1().textContent).toBe('This is your own invite');
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(i.ownInvite);
    expect(status.className).not.toContain('text-error');
    expect(status.className.split(' ')).toContain('bg-sunken');
    expect(link(i.backToCoach)).toBe('/coach');
  });

  it.each(['invite.invalid', 'invite.ownInvite', 'invite.coachFull'] as const)(
    'offers its way on as a secondary button, never the primary, for %s',
    (reason) => {
      renderView(refused(reason));
      const classes = screen
        .getByRole('link', {
          name:
            reason === 'invite.ownInvite'
              ? i.backToCoach
              : MESSAGES.nav.goToday,
        })
        .className.split(' ');
      expect(classes).toContain('border-border-strong');
      expect(classes).not.toContain('bg-accent');
    },
  );

  it("keeps a full coach's refusal, in the error tone", () => {
    renderView(refused('invite.coachFull'));
    expect(h1().textContent).toBe(i.title);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(
      'This coach cannot link any more players. Let your coach know.',
    );
    expect(status.className).toContain('text-error');
    expect(link(MESSAGES.nav.goToday)).toBe('/');
  });

  it.each(['invite.invalid', 'invite.ownInvite', 'invite.coachFull'] as const)(
    'offers no way to accept and names no one for %s',
    (reason) => {
      renderView(refused(reason));
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByText(/Rimantas/u)).toBeNull();
    },
  );
});
