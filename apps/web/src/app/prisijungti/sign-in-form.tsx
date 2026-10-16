'use client';

import type { Locale } from '@mychess/domain';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, type JSX, type SubmitEvent } from 'react';
import { authClient } from '../../lib/auth-client';
import { offeredProviders, type Provider } from '../../lib/providers';
import { ROUTES } from '../../lib/routes';
import {
  clientErrorKey,
  signInErrorKey,
  type SignInErrorKey,
} from '../../lib/sign-in-errors';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttons';
import { StatusLine, type StatusLineProps } from '../status-line';

export interface SignInFormProps {
  /** The `?error=` code a failed sign-in was sent back with. */
  readonly error?: string | undefined;
  /** The account was just deleted (`?deleted=1`). */
  readonly deleted: boolean;
  /** Google is offered only when the server has its credentials. */
  readonly googleEnabled: boolean;
}

interface StatusMessage {
  readonly key: SignInErrorKey | 'signIn.sent' | 'signIn.deleted';
  readonly tone: StatusLineProps['tone'];
}

/** Runs a sign-in request and shows the message it ends with. */
type Run = (action: () => Promise<StatusMessage | null>) => void;

// Where Better Auth sends the browser: home, onboarding for a new account,
// or back here with `?error=`.
const URLS = {
  callbackURL: ROUTES.home,
  newUserCallbackURL: ROUTES.onboarding,
  errorCallbackURL: ROUTES.signIn,
} as const;

const SENT: StatusMessage = { key: 'signIn.sent', tone: 'success' };
const GENERIC: StatusMessage = { key: 'signIn.error.generic', tone: 'error' };

const failed = (key: SignInErrorKey): StatusMessage => ({ key, tone: 'error' });

function initialMessage(
  error: string | undefined,
  deleted: boolean,
): StatusMessage | null {
  if (error !== undefined) return failed(signInErrorKey(error));
  return deleted ? { key: 'signIn.deleted', tone: 'info' } : null;
}

/** Mails a magic link; the message to show for the outcome. */
async function requestMagicLink(
  email: string,
  locale: Locale,
): Promise<StatusMessage> {
  try {
    const { error } = await authClient.signIn.magicLink({
      email,
      ...URLS,
      metadata: { locale },
    });
    return error === null ? SENT : failed(clientErrorKey(error));
  } catch {
    return GENERIC;
  }
}

/** Starts a provider sign-in; on success the browser leaves this page. */
async function startProvider(
  provider: Provider,
): Promise<StatusMessage | null> {
  try {
    const { error } = await authClient.signIn.social({ provider, ...URLS });
    return error === null ? null : GENERIC;
  } catch {
    return GENERIC;
  }
}

/** The email field and the button that mails a magic link. */
function EmailForm({
  busy,
  run,
}: {
  readonly busy: boolean;
  readonly run: Run;
}): JSX.Element {
  const t = useTranslations('signIn');
  const locale = useLocale();
  const emailId = useId();
  const [email, setEmail] = useState('');
  // noValidate: the server's refusal is shown in the page's language,
  // not the browser's.
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(() => requestMagicLink(email, locale));
  };
  return (
    <form noValidate className="flex flex-col gap-3" onSubmit={submit}>
      <label htmlFor={emailId} className="font-medium">
        {t('email')}
      </label>
      <input
        id={emailId}
        type="email"
        name="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
        className="min-h-touch rounded-control border border-border-strong bg-surface px-3 text-base text-fg"
      />
      <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
        {t('submit')}
      </button>
    </form>
  );
}

/** "or", then a button per provider the server offers. */
function ProviderButtons({
  busy,
  run,
  googleEnabled,
}: {
  readonly busy: boolean;
  readonly run: Run;
  readonly googleEnabled: boolean;
}): JSX.Element {
  const t = useTranslations('signIn');
  const providers = offeredProviders(googleEnabled);
  return (
    <>
      <div className="flex items-center gap-3 text-sm text-fg-muted">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        {t('or')}
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-3">
        {providers.map((provider) => (
          <button
            key={provider}
            type="button"
            disabled={busy}
            className={SECONDARY_BUTTON}
            onClick={() => {
              run(() => startProvider(provider));
            }}
          >
            {t(provider)}
          </button>
        ))}
      </div>
    </>
  );
}

/** The sign-in screen: a magic link by email, or Google or Lichess. */
export function SignInForm({
  error,
  deleted,
  googleEnabled,
}: SignInFormProps): JSX.Element {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(() => initialMessage(error, deleted));
  const run: Run = (action) => {
    setBusy(true);
    setMessage(null);
    void action().then((next) => {
      setMessage(next);
      setBusy(false);
    });
  };
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-gutter py-8 sm:px-gutter-wide">
      <div className="flex flex-col gap-6 sm:rounded-card sm:border sm:border-border sm:bg-surface sm:p-8 sm:shadow-card">
        <header className="flex flex-col gap-2">
          <p className="text-lg font-bold text-accent">{t('app.title')}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">
            {t('signIn.title')}
          </h1>
          <p className="text-fg-muted">{t('signIn.intro')}</p>
        </header>
        <StatusLine
          text={message === null ? null : t(message.key)}
          tone={message?.tone ?? 'info'}
        />
        <EmailForm busy={busy} run={run} />
        <ProviderButtons busy={busy} run={run} googleEnabled={googleEnabled} />
      </div>
    </main>
  );
}
