import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { queueKey } from '../treniruote/result-queue';
import { SignInForm, type SignInFormProps } from './sign-in-form';

interface ClientAnswer {
  readonly data: unknown;
  readonly error: {
    readonly status: number;
    readonly code?: string;
    readonly message?: string;
  } | null;
}

const client = vi.hoisted(() => ({
  magicLink: vi.fn<(body: unknown) => Promise<ClientAnswer>>(),
  social: vi.fn<(body: unknown) => Promise<ClientAnswer>>(),
}));

vi.mock('../../lib/auth-client', () => ({
  authClient: {
    signIn: { magicLink: client.magicLink, social: client.social },
  },
}));

const OK: ClientAnswer = { data: { status: true }, error: null };

const URLS = {
  callbackURL: '/',
  newUserCallbackURL: '/pradzia',
  errorCallbackURL: '/prisijungti',
};

const lt = MESSAGES.lt;
const en = MESSAGES.en;

function renderForm(
  props: Partial<SignInFormProps> = {},
  locale: 'lt' | 'en' = 'lt',
): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <SignInForm googleEnabled deleted={false} {...props} />
    </NextIntlClientProvider>,
  );
}

const status = () => screen.getByRole('status');

async function submitEmail(email: string, button = lt.signIn.submit) {
  fireEvent.change(screen.getByLabelText(lt.signIn.email), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: button }));
  await waitFor(() => {
    expect(client.magicLink).toHaveBeenCalledTimes(1);
  });
}

beforeEach(() => {
  client.magicLink.mockReset().mockResolvedValue(OK);
  client.social.mockReset().mockResolvedValue(OK);
});

describe('SignInForm', () => {
  it('names the page and starts with an empty status line', () => {
    renderForm();
    expect(
      screen.getByRole('heading', { level: 1, name: lt.signIn.title }),
    ).toBeDefined();
    expect(status().textContent).toBe('');
  });

  it('mails a magic link to the email as typed, in the page language, then says to check the email', async () => {
    renderForm();
    await submitEmail('Ruta@Example.lt');
    expect(client.magicLink).toHaveBeenCalledWith({
      email: 'Ruta@Example.lt',
      ...URLS,
      metadata: { locale: 'lt' },
    });
    await waitFor(() => {
      expect(status().textContent).toBe(lt.signIn.sent);
    });
  });

  it('asks for the magic link in English on the English page', async () => {
    renderForm({}, 'en');
    fireEvent.change(screen.getByLabelText(en.signIn.email), {
      target: { value: 'ruta@example.lt' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.signIn.submit }));
    await waitFor(() => {
      expect(status().textContent).toBe(en.signIn.sent);
    });
    expect(client.magicLink).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { locale: 'en' } }),
    );
  });

  it('says the email is not valid when the server refuses it', async () => {
    client.magicLink.mockResolvedValue({
      data: null,
      error: {
        status: 400,
        code: 'account.emailInvalid',
        message: 'account.emailInvalid',
      },
    });
    renderForm();
    await submitEmail('ruta@');
    await waitFor(() => {
      expect(status().textContent).toBe(lt.account.emailInvalid);
    });
  });

  it('says to wait when too many links were asked for', async () => {
    client.magicLink.mockResolvedValue({
      data: null,
      error: { status: 429, message: 'Too many requests.' },
    });
    renderForm();
    await submitEmail('ruta@example.lt');
    await waitFor(() => {
      expect(status().textContent).toBe(lt.signIn.error.tooManyRequests);
    });
  });

  it('shows the general error for any other refusal', async () => {
    client.magicLink.mockResolvedValue({
      data: null,
      error: { status: 500, message: 'Internal Server Error' },
    });
    renderForm();
    await submitEmail('ruta@example.lt');
    await waitFor(() => {
      expect(status().textContent).toBe(lt.signIn.error.generic);
    });
  });

  it('shows the general error when the request fails', async () => {
    client.magicLink.mockRejectedValue(new TypeError('Failed to fetch'));
    renderForm();
    await submitEmail('ruta@example.lt');
    await waitFor(() => {
      expect(status().textContent).toBe(lt.signIn.error.generic);
    });
  });

  it('cannot send twice while a link is on its way', async () => {
    let answer: (value: ClientAnswer) => void = () => undefined;
    client.magicLink.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderForm();
    await submitEmail('ruta@example.lt');
    const submit = screen.getByRole('button', { name: lt.signIn.submit });
    expect(submit.hasAttribute('disabled')).toBe(true);
    answer(OK);
    await waitFor(() => {
      expect(submit.hasAttribute('disabled')).toBe(false);
    });
  });

  it.each([
    ['google', lt.signIn.google],
    ['lichess', lt.signIn.lichess],
  ] as const)('signs in with %s', async (provider, label) => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => {
      expect(client.social).toHaveBeenCalledWith({ provider, ...URLS });
    });
    expect(status().textContent).toBe('');
  });

  it('shows the general error when a provider sign-in cannot start', async () => {
    client.social.mockResolvedValue({
      data: null,
      error: { status: 404, message: 'Provider not found' },
    });
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: lt.signIn.lichess }));
    await waitFor(() => {
      expect(status().textContent).toBe(lt.signIn.error.generic);
    });
  });

  it('offers no Google button when Google is not set up', () => {
    renderForm({ googleEnabled: false });
    expect(screen.queryByRole('button', { name: lt.signIn.google })).toBeNull();
    expect(
      screen.getByRole('button', { name: lt.signIn.lichess }),
    ).toBeDefined();
  });

  it.each([
    ['lichess_email_in_use', lt.signIn.error.lichessEmailInUse],
    ['account_not_linked', lt.signIn.error.lichessEmailInUse],
    ['account.emailInvalid', lt.account.emailInvalid],
    ['state_mismatch', lt.signIn.error.generic],
    ['state_not_found', lt.signIn.error.generic],
    ['unable_to_create_user', lt.signIn.error.generic],
    ['INVALID_TOKEN', lt.signIn.error.linkExpired],
    ['invalid_token', lt.signIn.error.generic],
    ['anything', lt.signIn.error.generic],
    ['constructor', lt.signIn.error.generic],
  ])('translates the error code %s', (error, text) => {
    renderForm({ error });
    expect(status().textContent).toBe(text);
  });

  it('says the account was deleted', () => {
    renderForm({ deleted: true });
    expect(status().textContent).toBe(lt.signIn.deleted);
  });

  it('removes every queued training result once the account was deleted, and keeps them otherwise', () => {
    window.localStorage.clear();
    window.localStorage.setItem(queueKey('rokas'), '[]');
    window.localStorage.setItem('theme', 'dark');
    renderForm();
    expect(window.localStorage.getItem(queueKey('rokas'))).toBe('[]');
    renderForm({ deleted: true });
    expect(window.localStorage.getItem(queueKey('rokas'))).toBeNull();
    expect(window.localStorage.getItem('theme')).toBe('dark');
  });
});

describe('SignInForm with a return path (R-81)', () => {
  const TOKEN = 'A'.repeat(42) + '_';
  const NEXT = `/k/${TOKEN}`;
  const BACK = {
    callbackURL: NEXT,
    newUserCallbackURL: `/pradzia?next=%2Fk%2F${TOKEN}`,
    errorCallbackURL: `/prisijungti?next=%2Fk%2F${TOKEN}`,
  };

  it('sends the magic link back to the invite, through onboarding for a new account', async () => {
    renderForm({ next: NEXT });
    await submitEmail('ruta@example.lt');
    expect(client.magicLink).toHaveBeenCalledWith({
      email: 'ruta@example.lt',
      ...BACK,
      metadata: { locale: 'lt' },
    });
  });

  it.each([
    ['google', lt.signIn.google],
    ['lichess', lt.signIn.lichess],
  ] as const)(
    'sends a %s sign-in back to the invite',
    async (provider, label) => {
      renderForm({ next: NEXT });
      fireEvent.click(screen.getByRole('button', { name: label }));
      await waitFor(() => {
        expect(client.social).toHaveBeenCalledWith({ provider, ...BACK });
      });
    },
  );

  it('keeps the plain destinations with no return path', async () => {
    renderForm({ next: null });
    await submitEmail('ruta@example.lt');
    expect(client.magicLink).toHaveBeenCalledWith(
      expect.objectContaining(URLS),
    );
  });
});
