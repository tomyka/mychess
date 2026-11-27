import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../i18n/catalogue';
import type { CreateInviteState, RevokeInviteState } from '../../actions';
import { GroupInviteLink } from './group-invite-link';

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

vi.mock('../../actions', () => ({
  createInviteAction: server.create,
  revokeInviteAction: server.revoke,
}));

const g = MESSAGES.coach.group;
const i = MESSAGES.coach.invites;

const TODAY = '2026-11-27';
// 22:30 UTC on 9 December is already 10 December in Vilnius (UTC+2).
const EXPIRES = new Date('2026-12-09T22:30:00Z');
const LINK = `http://localhost:3000/invite/${'A'.repeat(43)}`;

const scrolled = vi.fn<(options?: ScrollIntoViewOptions) => void>();

beforeEach(() => {
  server.create
    .mockReset()
    .mockResolvedValue({ link: LINK, expiresAt: EXPIRES });
  server.revoke.mockReset().mockResolvedValue({});
  scrolled.mockReset();
  // jsdom has no scrollIntoView; the new link asks for it.
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrolled,
  });
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

function show({
  invite = null,
}: {
  invite?: { id: string; expiresAt: Date } | null;
} = {}): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <GroupInviteLink groupId="g-1" invite={invite} today={TODAY} />
    </NextIntlClientProvider>,
  );
}

const section = () =>
  within(screen.getByRole('region', { name: g.inviteTitle }));

describe('GroupInviteLink (R-232)', () => {
  it('says when the open link expires, and that links are shown once', () => {
    show({ invite: { id: 'i-1', expiresAt: EXPIRES } });
    expect(section().getByText('An open link expires Dec 10')).toBeDefined();
    expect(section().getByText(g.linkHint)).toBeDefined();
    expect(section().queryByText(g.noOpenLink)).toBeNull();
  });

  it('says there is no open link, and still says links are shown once', () => {
    show();
    expect(section().getByText(g.noOpenLink)).toBeDefined();
    expect(section().getByText(g.linkHint)).toBeDefined();
  });

  it('makes a group invite with New link and shows it inline with Copy, in view', async () => {
    show();
    expect(section().queryByLabelText(i.link)).toBeNull();
    fireEvent.click(section().getByRole('button', { name: g.newLink }));
    await waitFor(() => {
      expect(server.create).toHaveBeenCalledTimes(1);
    });
    expect(
      Object.fromEntries(server.create.mock.lastCall?.[1].entries() ?? []),
    ).toEqual({ kind: 'group', groupId: 'g-1' });
    const field = await section().findByLabelText<HTMLInputElement>(i.link);
    expect(field.value).toBe(LINK);
    expect(section().getByRole('button', { name: i.copy })).toBeDefined();
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('shows a refused New link, the invite limit with its number (R-114)', async () => {
    server.create.mockResolvedValue({ refusal: 'coach.inviteLimit' });
    show();
    fireEvent.click(section().getByRole('button', { name: g.newLink }));
    await waitFor(() => {
      expect(section().getByRole('status').textContent).toBe(
        MESSAGES.coach.inviteLimit.replace('{limit}', '50'),
      );
    });
    expect(section().queryByLabelText(i.link)).toBeNull();
  });
});

describe('GroupInviteLink: Revoke (R-233)', () => {
  const OPEN = { id: 'i-1', expiresAt: EXPIRES };
  const revoke = () => section().getByRole('button', { name: i.revoke });

  it('has no Revoke without an open link', () => {
    show();
    expect(section().queryByRole('button', { name: i.revoke })).toBeNull();
  });

  it('revokes the open link in the error tone, only after the confirm step', async () => {
    show({ invite: OPEN });
    expect(revoke().className).toContain('text-error');
    fireEvent.click(revoke());
    expect(server.revoke).not.toHaveBeenCalled();
    expect(section().getByText(g.revokeConfirm)).toBeDefined();
    fireEvent.click(
      section().getByRole('button', {
        name: MESSAGES.coach.inviteSheet.confirmRevoke,
      }),
    );
    await waitFor(() => {
      expect(server.revoke).toHaveBeenCalledTimes(1);
    });
    expect(
      Object.fromEntries(server.revoke.mock.lastCall?.[1].entries() ?? []),
    ).toEqual({ inviteId: 'i-1' });
  });

  it('says No open link once revoked, and no longer shows a link just made', async () => {
    const view = render(
      <NextIntlClientProvider
        locale="en"
        messages={MESSAGES}
        timeZone="Europe/Vilnius"
      >
        <GroupInviteLink groupId="g-1" invite={OPEN} today={TODAY} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(section().getByRole('button', { name: g.newLink }));
    await section().findByLabelText(i.link);
    fireEvent.click(revoke());
    fireEvent.click(
      section().getByRole('button', {
        name: MESSAGES.coach.inviteSheet.confirmRevoke,
      }),
    );
    await waitFor(() => {
      expect(section().queryByLabelText(i.link)).toBeNull();
    });
    // The refreshed page has no open link.
    view.rerender(
      <NextIntlClientProvider
        locale="en"
        messages={MESSAGES}
        timeZone="Europe/Vilnius"
      >
        <GroupInviteLink groupId="g-1" invite={null} today={TODAY} />
      </NextIntlClientProvider>,
    );
    expect(section().getByText(g.noOpenLink)).toBeDefined();
    expect(section().queryByRole('button', { name: i.revoke })).toBeNull();
  });

  it('says why a Revoke was refused: used up, expired or revoked since', async () => {
    server.revoke.mockResolvedValue({ refusal: 'invite.invalid' });
    show({ invite: OPEN });
    fireEvent.click(revoke());
    fireEvent.click(
      section().getByRole('button', {
        name: MESSAGES.coach.inviteSheet.confirmRevoke,
      }),
    );
    await waitFor(() => {
      expect(
        section()
          .getAllByRole('status')
          .map((status) => status.textContent),
      ).toContain(i.revokeInvalid);
    });
  });
});
