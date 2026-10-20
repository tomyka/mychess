'use client';

import { useTranslations } from 'next-intl';
import { useActionState, type JSX } from 'react';
import { SECONDARY_BUTTON } from '../../../buttons';
import { PendingButton } from '../../../pending-button';
import { StatusLine } from '../../../status-line';
import { pauseAction } from './actions';

/**
 * Pause or resume the assignment (R-46): while paused, "Paused" and what it
 * means show over a Resume button. A refusal shows under it, the state as
 * it was.
 */
export function PauseControl({
  repertoireId,
  paused,
}: {
  readonly repertoireId: string;
  /** The state the page loaded with. */
  readonly paused: boolean;
}): JSX.Element {
  const t = useTranslations();
  const [state, toggle] = useActionState(pauseAction, { paused });
  return (
    <form action={toggle} className="flex flex-col gap-2">
      <input type="hidden" name="repertoireId" value={repertoireId} />
      <input type="hidden" name="paused" value={String(!state.paused)} />
      {state.paused ? (
        <div className="flex flex-col gap-1">
          <p className="font-semibold">{t('assignment.pause.paused')}</p>
          <p className="text-sm text-fg-muted">
            {t('assignment.pause.pausedHint')}
          </p>
        </div>
      ) : null}
      <PendingButton className={`${SECONDARY_BUTTON} self-start`}>
        {state.paused
          ? t('assignment.pause.resume')
          : t('assignment.pause.pause')}
      </PendingButton>
      <StatusLine
        text={state.refusal === undefined ? null : t(state.refusal)}
        tone="error"
      />
    </form>
  );
}
