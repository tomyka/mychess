'use client';

import { useMessages, useTranslations } from 'next-intl';
import { useEffect, useRef, type JSX } from 'react';
import { isMessageKey } from '../../i18n/message-key';
import { SECONDARY_BUTTON } from '../buttons';
import { StatusLine } from '../status-line';
import type { ScreenMessage } from './screen-state';

export interface ScreenStatusProps {
  readonly message: ScreenMessage | null;
  /** The repertoire changed in another window: offer Reload. */
  readonly stale: boolean;
  readonly onReload: () => void;
}

/**
 * The page's one status line for board actions and refusals
 * (docs/design/repertoire-screen.md). A stale repertoire adds Reload, which
 * takes focus when it appears.
 */
export function ScreenStatus({
  message,
  stale,
  onReload,
}: ScreenStatusProps): JSX.Element {
  const t = useTranslations();
  const messages = useMessages();
  const reload = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (stale) reload.current?.focus();
  }, [stale]);
  let text: string | null = null;
  if (message !== null)
    text = isMessageKey(messages, message.key)
      ? t(message.key, message.values)
      : t('repertoires.failed');
  return (
    <div className="flex flex-col gap-2">
      <StatusLine text={text} tone={message?.tone ?? 'info'} />
      {stale ? (
        <button
          ref={reload}
          type="button"
          onClick={onReload}
          className={`${SECONDARY_BUTTON} self-start`}
        >
          {t('repertoires.stale.reload')}
        </button>
      ) : null}
    </div>
  );
}
