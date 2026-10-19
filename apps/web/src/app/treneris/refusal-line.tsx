'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { StatusLine } from '../status-line';
import type { CoachActionState } from './actions';

/** A refused coach action, in the section it was asked in. */
export function RefusalLine({
  state,
}: {
  readonly state: CoachActionState;
}): JSX.Element {
  const t = useTranslations();
  return (
    <StatusLine
      text={state.refusal === undefined ? null : t(state.refusal)}
      tone="error"
    />
  );
}
