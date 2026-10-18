import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/locales';
import type { AcceptState } from './actions';
import { InviteView, type InvitePreviewResult } from './invite-view';

const server = vi.hoisted(() => ({
  accept:
    vi.fn<(previous: AcceptState, form: FormData) => Promise<AcceptState>>(),
}));

vi.mock('./actions', () => ({ acceptInviteAction: server.accept }));

const i = MESSAGES.lt.invite;
const TOKEN = 'A'.repeat(42) + '_';

const GROUP_INVITE: InvitePreviewResult = {
  ok: true,
  value: {
    coachDisplayName: 'Jonas',
    groupName: 'Šeštadienio grupė',
    kind: 'group',
  },
};

const refused = (
  reason: Extract<InvitePreviewResult, { ok: false }>['refusal']['reason'],
): InvitePreviewResult => ({ ok: false, refusal: { reason } });

function renderView(
  preview: InvitePreviewResult,
  locale: 'lt' | 'en' = 'lt',
): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <InviteView token={TOKEN} preview={preview} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  server.accept.mockReset().mockResolvedValue({});
});

describe('InviteView', () => {
  it('names the coach and the group, with Accept and Not now', () => {
    renderView(GROUP_INVITE);
    expect(
      screen.getByRole('heading', { level: 1, name: i.title }),
    ).toBeDefined();
    expect(screen.getByText('Treneris: Jonas')).toBeDefined();
    expect(screen.getByText('Grupė: Šeštadienio grupė')).toBeDefined();
    expect(screen.getByText(i.explain)).toBeDefined();
    expect(screen.getByRole('button', { name: i.accept })).toBeDefined();
    expect(
      screen.getByRole('link', { name: i.notNow }).getAttribute('href'),
    ).toBe('/');
  });

  it('names no group for a personal invite without one', () => {
    renderView({
      ok: true,
      value: { coachDisplayName: 'Jonas', groupName: null, kind: 'personal' },
    });
    expect(screen.getByText('Treneris: Jonas')).toBeDefined();
    expect(screen.queryByText(/^Grupė:/u)).toBeNull();
  });

  it('accepts by posting only the token (the account is the session’s)', async () => {
    renderView(GROUP_INVITE);
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
    renderView(GROUP_INVITE);
    fireEvent.click(screen.getByRole('button', { name: i.accept }));
    expect(await screen.findByText(i.invalid)).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: i.accept })).toBeNull();
    });
  });

  it.each([
    ['invite.invalid', i.invalid],
    ['invite.notCoach', i.invalid],
    ['invite.ownInvite', i.ownInvite],
    ['invite.coachFull', i.coachFull],
  ] as const)('says %s without a way to accept', (reason, text) => {
    renderView(refused(reason));
    expect(
      screen.getByRole('heading', { level: 1, name: i.title }),
    ).toBeDefined();
    expect(screen.getByText(text)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Jonas/u)).toBeNull();
    expect(
      screen.getByRole('link', { name: i.home }).getAttribute('href'),
    ).toBe('/');
  });

  it('speaks English on the English page', () => {
    renderView(GROUP_INVITE, 'en');
    expect(screen.getByText('Coach: Jonas')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Accept invite' })).toBeDefined();
  });
});
