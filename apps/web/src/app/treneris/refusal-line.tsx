'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import type { MessageKey } from '../../i18n/message-key';
import { StatusLine } from '../status-line';

/** A refused coach action, in the section it was asked in. */
export function RefusalLine({
  state,
}: {
  readonly state: { readonly refusal?: MessageKey };
}): JSX.Element {
  const t = useTranslations();
  return (
    <StatusLine
      text={state.refusal === undefined ? null : t(state.refusal)}
      tone="error"
    />
  );
}
