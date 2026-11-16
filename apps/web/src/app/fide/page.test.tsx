import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import FidePage from './page';

const server = vi.hoisted(() => ({
  account: vi.fn<() => Promise<unknown>>(),
}));

// requireOnboarded never returns for a signed-out or new account; the
// feature suite covers that for the actions.
vi.mock('../../server/session', () => ({ requireOnboarded: server.account }));
vi.mock('@mychess/db', () => ({ FOUND_GAMES_LIMIT: 1000 }));
vi.mock('./actions', () => ({
  startFideSearchAction: vi.fn(),
  pollFideSearchAction: vi.fn(),
  addBroadcastLinkAction: vi.fn(),
}));

const en = MESSAGES.en.fide;

beforeEach(() => {
  server.account.mockReset().mockResolvedValue({ id: 'rokas' });
});

describe('the FIDE ID search page', () => {
  it('signs in first, then shows the title, the way home, what it does, the field and the broadcast link form', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
        {await FidePage()}
      </NextIntlClientProvider>,
    );
    expect(server.account).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('heading', { level: 1, name: en.title }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: en.home }).getAttribute('href'),
    ).toBe('/');
    expect(screen.getByText(en.intro)).toBeDefined();
    expect(screen.getByLabelText(en.idLabel)).toBeDefined();
    expect(
      screen.getByRole('heading', { level: 2, name: en.addTitle }),
    ).toBeDefined();
    expect(screen.getByLabelText(en.linkLabel)).toBeDefined();
    expect(
      screen.getAllByRole('status').map((status) => status.textContent),
    ).toEqual(['', '']);
  });

  it('does not render for an account the session refuses', async () => {
    server.account.mockRejectedValue(new Error('redirect to sign-in'));
    await expect(FidePage()).rejects.toThrow('redirect');
  });
});
