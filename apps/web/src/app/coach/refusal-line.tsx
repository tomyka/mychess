'use client';

import { OPEN_INVITE_LIMIT } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import type { MessageKey } from '../../i18n/message-key';
import { StatusLine } from '../status-line';

/** A form's refusal: its key, and the limit it names when it is one (R-162). */
interface RefusalShown {
  readonly refusal?: MessageKey;
  readonly limit?: number;
}

/** The words of a form's refusal, or null when there is none. */
export function useRefusalText(): (state: RefusalShown) => string | null {
  const t = useTranslations();
  return ({ refusal, limit }) =>
    refusal === undefined
      ? null
      : t(refusal, limit === undefined ? {} : { limit });
}

/**
 * A refused invite, which names the open-invite limit when it is the
 * reason (R-114): the Invite a player sheet and a group's New link.
 */
export function InviteRefusalLine({
  refusal,
}: {
  readonly refusal: MessageKey | undefined;
}): JSX.Element {
  return (
    <RefusalLine
      state={refusal === undefined ? {} : { refusal, limit: OPEN_INVITE_LIMIT }}
    />
  );
}

/** A refused action, in the section it was asked in. */
export function RefusalLine({
  state,
}: {
  readonly state: RefusalShown;
}): JSX.Element {
  const text = useRefusalText();
  return <StatusLine text={text(state)} tone="error" />;
}
