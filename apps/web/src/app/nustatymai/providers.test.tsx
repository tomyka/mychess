import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { Providers, type ProvidersProps } from './providers';

interface ClientAnswer {
  readonly data: unknown;
  readonly error: {
    readonly status: number;
    readonly code?: string;
    readonly message?: string;
  } | null;
}

const client = vi.hoisted(() => ({
  linkSocial: vi.fn<(body: unknown) => Promise<ClientAnswer>>(),
  unlinkAccount: vi.fn<(body: unknown) => Promise<ClientAnswer>>(),
  refresh: vi.fn<() => void>(),
}));

vi.mock('../../lib/auth-client', () => ({
  authClient: {
    linkSocial: client.linkSocial,
    unlinkAccount: client.unlinkAccount,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: client.refresh }),
}));

const OK: ClientAnswer = { data: { status: true }, error: null };
const lt = MESSAGES.lt;
const en = MESSAGES.en;
const p = lt.settings.providers;

const label = (template: string, provider: string) =>
  template.replace('{provider}', provider);

function renderProviders(
  props: Partial<ProvidersProps> = {},
  locale: 'lt' | 'en' = 'lt',
): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <Providers links={[]} googleEnabled email="ruta@example.lt" {...props} />
    </NextIntlClientProvider>,
  );
}

const status = () => screen.getByRole('status');
const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  client.linkSocial.mockReset().mockResolvedValue(OK);
  client.unlinkAccount.mockReset().mockResolvedValue(OK);
  client.refresh.mockReset();
});

describe('Providers', () => {
  it('says the email link always works, to the account’s address (decision 6)', () => {
    renderProviders();
    expect(
      screen.getByRole('heading', { level: 2, name: p.title }),
    ).toBeDefined();
    expect(
      screen.getByText(p.intro.replace('{email}', 'ruta@example.lt')),
    ).toBeDefined();
    expect(status().textContent).toBe('');
  });

  it('offers to connect each provider that is not linked', () => {
    renderProviders();
    expect(screen.getAllByText(p.notLinked)).toHaveLength(2);
    expect(button(label(p.link, 'Google'))).toBeDefined();
    expect(button(label(p.link, 'Lichess'))).toBeDefined();
    expect(screen.queryByText(p.linked)).toBeNull();
  });

  it.each([
    ['google', 'Google'],
    ['lichess', 'Lichess'],
  ] as const)(
    'links %s and comes back to settings either way',
    async (provider, name) => {
      renderProviders();
      fireEvent.click(button(label(p.link, name)));
      await waitFor(() => {
        expect(client.linkSocial).toHaveBeenCalledWith({
          provider,
          callbackURL: '/nustatymai',
          errorCallbackURL: '/nustatymai',
        });
      });
      expect(status().textContent).toBe('');
    },
  );

  it('shows a linked provider with a button that unlinks it by its link id', async () => {
    renderProviders({ links: [{ id: 'pa-7', provider: 'lichess' }] });
    expect(screen.getAllByText(p.linked)).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: label(p.link, 'Lichess') }),
    ).toBeNull();
    fireEvent.click(button(label(p.unlink, 'Lichess')));
    await waitFor(() => {
      expect(client.refresh).toHaveBeenCalledTimes(1);
    });
    expect(client.unlinkAccount).toHaveBeenCalledWith({ accountId: 'pa-7' });
    expect(client.linkSocial).not.toHaveBeenCalled();
    expect(status().textContent).toBe('');
  });

  it('asks to sign in again when the session is too old to unlink', async () => {
    client.unlinkAccount.mockResolvedValue({
      data: null,
      error: {
        status: 403,
        code: 'SESSION_NOT_FRESH',
        message: 'Session is not fresh',
      },
    });
    renderProviders({ links: [{ id: 'pa-7', provider: 'google' }] });
    fireEvent.click(button(label(p.unlink, 'Google')));
    await waitFor(() => {
      expect(status().textContent).toBe(p.error.notFresh);
    });
    expect(client.refresh).not.toHaveBeenCalled();
  });

  it('shows the general error when a link cannot start or the request fails', async () => {
    client.linkSocial.mockResolvedValue({
      data: null,
      error: { status: 404, message: 'Provider not found' },
    });
    renderProviders();
    fireEvent.click(button(label(p.link, 'Google')));
    await waitFor(() => {
      expect(status().textContent).toBe(p.error.generic);
    });
    client.unlinkAccount.mockRejectedValue(new TypeError('Failed to fetch'));
    renderProviders({ links: [{ id: 'pa-1', provider: 'lichess' }] });
    fireEvent.click(button(label(p.unlink, 'Lichess')));
    await waitFor(() => {
      expect(screen.getAllByRole('status')[1]?.textContent).toBe(
        p.error.generic,
      );
    });
  });

  it('disables the buttons while a request runs', async () => {
    let answer: (value: ClientAnswer) => void = () => undefined;
    client.linkSocial.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderProviders();
    fireEvent.click(button(label(p.link, 'Lichess')));
    await waitFor(() => {
      expect(button(label(p.link, 'Google')).hasAttribute('disabled')).toBe(
        true,
      );
    });
    answer({ data: null, error: { status: 500 } });
    await waitFor(() => {
      expect(button(label(p.link, 'Google')).hasAttribute('disabled')).toBe(
        false,
      );
    });
  });

  it('offers no Google row when Google is not set up', () => {
    renderProviders({ googleEnabled: false });
    expect(
      screen.queryByRole('button', { name: label(p.link, 'Google') }),
    ).toBeNull();
    expect(screen.getAllByText(p.notLinked)).toHaveLength(1);
  });

  it.each([
    ['account_already_linked_to_different_user', p.error.linkedElsewhere],
    ['SESSION_NOT_FRESH', p.error.notFresh],
    ['unable_to_link_account', p.error.generic],
    ['constructor', p.error.generic],
  ])('translates the error code %s it was sent back with', (error, text) => {
    renderProviders({ error });
    expect(status().textContent).toBe(text);
  });

  it('speaks English on the English page', () => {
    renderProviders({ links: [{ id: 'pa-1', provider: 'google' }] }, 'en');
    expect(button(label(en.settings.providers.unlink, 'Google'))).toBeDefined();
    expect(screen.getByText(en.settings.providers.linked)).toBeDefined();
  });
});
