'use client';

import type { Provider } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, type JSX, type ReactNode } from 'react';
import { authClient } from '../../lib/auth-client';
import { offeredProviders } from '../../lib/providers';
import { ROUTES } from '../../lib/routes';
import { linkErrorKey, type LinkErrorKey } from '../../lib/sign-in-errors';
import type { ProviderLink } from '../../server/provider-links';
import { StatusLine } from '../status-line';
import { SECONDARY_BUTTON } from '../buttons';
import { SECTION, SECTION_TITLE } from './styles';

export interface ProvidersProps {
  /** The account's Google and Lichess links. */
  readonly links: readonly ProviderLink[];
  /** Google is offered only when the server has its credentials. */
  readonly googleEnabled: boolean;
  /** The address magic links go to: that way in always works (decision 6). */
  readonly email: string;
  /** The `?error=` code a failed link was sent back with. */
  readonly error?: string | undefined;
  /** A notice about the links, shown above them (R-90). */
  readonly children?: ReactNode;
}

// Where Better Auth sends the browser after a link, whether it worked or not.
const BACK_HERE = {
  callbackURL: ROUTES.settings,
  errorCallbackURL: ROUTES.settings,
} as const;

/** The error a request ended with, or null when it went through. */
type Outcome = LinkErrorKey | null;

/** Starts a link; on success the browser leaves for the provider. */
async function link(provider: Provider): Promise<Outcome> {
  try {
    const { error } = await authClient.linkSocial({ provider, ...BACK_HERE });
    return error === null ? null : linkErrorKey(error.code);
  } catch {
    return linkErrorKey(undefined);
  }
}

/** Removes a link by its own id (`provider_accounts.id`). */
async function unlink(accountId: string): Promise<Outcome> {
  try {
    const { error } = await authClient.unlinkAccount({ accountId });
    return error === null ? null : linkErrorKey(error.code);
  } catch {
    return linkErrorKey(undefined);
  }
}

interface RowProps {
  readonly provider: Provider;
  readonly link: ProviderLink | undefined;
  readonly busy: boolean;
  readonly onLink: () => void;
  readonly onUnlink: (id: string) => void;
}

/** One provider: its name, whether it is linked, and the button to change it. */
function ProviderRow({
  provider,
  link: current,
  busy,
  onLink,
  onUnlink,
}: RowProps): JSX.Element {
  const t = useTranslations('settings.providers');
  const name = { provider: t(provider) };
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex flex-col">
        <span className="font-medium">{name.provider}</span>
        <span className="text-sm text-fg-muted">
          {current === undefined ? t('notLinked') : t('linked')}
        </span>
      </div>
      <button
        type="button"
        disabled={busy}
        className={SECONDARY_BUTTON}
        onClick={
          current === undefined
            ? onLink
            : () => {
                onUnlink(current.id);
              }
        }
      >
        {current === undefined ? t('link', name) : t('unlink', name)}
      </button>
    </li>
  );
}

/** Google and Lichess: link each from here, or unlink it. */
export function Providers({
  links,
  googleEnabled,
  email,
  error,
  children,
}: ProvidersProps): JSX.Element {
  const t = useTranslations();
  const router = useRouter();
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Outcome>(() =>
    error === undefined ? null : linkErrorKey(error),
  );
  const run = (request: () => Promise<Outcome>, refresh: boolean) => {
    setBusy(true);
    setFailure(null);
    void request().then((outcome) => {
      setFailure(outcome);
      setBusy(false);
      if (outcome === null && refresh) router.refresh();
    });
  };
  const providers = offeredProviders(googleEnabled);
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('settings.providers.title')}
      </h2>
      <p className="text-fg-muted">
        {t('settings.providers.intro', { email })}
      </p>
      {children}
      <StatusLine text={failure === null ? null : t(failure)} tone="error" />
      <ul className="flex flex-col divide-y divide-border">
        {providers.map((provider) => (
          <ProviderRow
            key={provider}
            provider={provider}
            link={links.find((l) => l.provider === provider)}
            busy={busy}
            onLink={() => {
              run(() => link(provider), false);
            }}
            onUnlink={(id) => {
              run(() => unlink(id), true);
            }}
          />
        ))}
      </ul>
    </section>
  );
}
