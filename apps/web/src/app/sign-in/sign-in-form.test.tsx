import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { queueKey } from '../training/result-queue';
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
  newUserCallbackURL: '/welcome',
  errorCallbackURL: '/sign-in',
};

const s = MESSAGES.signIn;

function renderForm(props: Partial<SignInFormProps> = {}): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <SignInForm googleEnabled deleted={false} {...props} />
    </NextIntlClientProvider>,
  );
}

const status = () => screen.getByRole('status');

async function submitEmail(email: string) {
  fireEvent.change(screen.getByLabelText(s.email), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: s.submit }));
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
      screen.getByRole('heading', { level: 1, name: s.title }),
    ).toBeDefined();
    expect(status().textContent).toBe('');
  });

  it('mails a magic link to the email as typed, with no locale metadata, then says to check the email', async () => {
    renderForm();
    await submitEmail('Ruta@Example.lt');
    expect(client.magicLink).toHaveBeenCalledWith({
      email: 'Ruta@Example.lt',
      ...URLS,
    });
    await waitFor(() => {
      expect(status().textContent).toBe(s.sent);
    });
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
      expect(status().textContent).toBe(MESSAGES.account.emailInvalid);
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
      expect(status().textContent).toBe(s.error.tooManyRequests);
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
      expect(status().textContent).toBe(s.error.generic);
    });
  });

  it('shows the general error when the request fails', async () => {
    client.magicLink.mockRejectedValue(new TypeError('Failed to fetch'));
    renderForm();
    await submitEmail('ruta@example.lt');
    await waitFor(() => {
      expect(status().textContent).toBe(s.error.generic);
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
    const submit = screen.getByRole('button', { name: s.submit });
    expect(submit.hasAttribute('disabled')).toBe(true);
    answer(OK);
    await waitFor(() => {
      expect(submit.hasAttribute('disabled')).toBe(false);
    });
  });

  it.each([
    ['google', s.google],
    ['lichess', s.lichess],
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
    fireEvent.click(screen.getByRole('button', { name: s.lichess }));
    await waitFor(() => {
      expect(status().textContent).toBe(s.error.generic);
    });
  });

  it('offers no Google button when Google is not set up', () => {
    renderForm({ googleEnabled: false });
    expect(screen.queryByRole('button', { name: s.google })).toBeNull();
    expect(screen.getByRole('button', { name: s.lichess })).toBeDefined();
  });

  it.each([
    ['lichess_email_in_use', s.error.lichessEmailInUse],
    ['account_not_linked', s.error.lichessEmailInUse],
    ['account.emailInvalid', MESSAGES.account.emailInvalid],
    ['state_mismatch', s.error.generic],
    ['state_not_found', s.error.generic],
    ['unable_to_create_user', s.error.generic],
    ['INVALID_TOKEN', s.error.linkExpired],
    ['invalid_token', s.error.generic],
    ['anything', s.error.generic],
    ['constructor', s.error.generic],
  ])('translates the error code %s', (error, text) => {
    renderForm({ error });
    expect(status().textContent).toBe(text);
  });

  it('says the account was deleted', () => {
    renderForm({ deleted: true });
    expect(status().textContent).toBe(s.deleted);
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
  const NEXT = `/invite/${TOKEN}`;
  const BACK = {
    callbackURL: NEXT,
    newUserCallbackURL: `/welcome?next=%2Finvite%2F${TOKEN}`,
    errorCallbackURL: `/sign-in?next=%2Finvite%2F${TOKEN}`,
  };

  it('sends the magic link back to the invite, through onboarding for a new account', async () => {
    renderForm({ next: NEXT });
    await submitEmail('ruta@example.lt');
    expect(client.magicLink).toHaveBeenCalledWith({
      email: 'ruta@example.lt',
      ...BACK,
    });
  });

  it.each([
    ['google', s.google],
    ['lichess', s.lichess],
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

  it('says the person signs in to accept a coach’s invite, naming no one for an invite that names no one (#329)', () => {
    renderForm({ next: NEXT, teaser: null });
    expect(screen.getByText(s.forInvite)).toBeDefined();
    expect(screen.queryByText(/invited you/u)).toBeNull();
    expect(screen.queryByText(s.description)).toBeNull();
  });

  it('names the coach and the group of a valid invite (R-235)', () => {
    renderForm({
      next: NEXT,
      teaser: { coachDisplayName: 'Rimantas V.', groupName: 'Juniors 2026' },
    });
    expect(
      screen.getByText(
        'Rimantas V. invited you to Juniors 2026. Sign in to accept.',
      ),
    ).toBeDefined();
    expect(screen.queryByText(s.forInvite)).toBeNull();
  });

  it('names the coach of a valid invite with no group (R-235)', () => {
    renderForm({
      next: NEXT,
      teaser: { coachDisplayName: 'Rimantas V.', groupName: null },
    });
    expect(
      screen.getByText(
        'Rimantas V. invited you to train with them. Sign in to accept.',
      ),
    ).toBeDefined();
  });

  it('says what MyChess is without an invite (#381 part 6)', () => {
    renderForm({ next: null });
    expect(
      screen.getByText(
        'Practise your openings, and train the repertoires your coach assigns you.',
      ),
    ).toBeDefined();
  });

  it('keeps the plain destinations with no return path', async () => {
    renderForm({ next: null });
    expect(screen.queryByText(s.forInvite)).toBeNull();
    await submitEmail('ruta@example.lt');
    expect(client.magicLink).toHaveBeenCalledWith(
      expect.objectContaining(URLS),
    );
  });
});
