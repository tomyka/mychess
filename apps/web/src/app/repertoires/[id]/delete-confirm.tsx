'use client';

import { FORK_OFFER_DAYS } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, type JSX } from 'react';
import { DANGER_BUTTON, SECONDARY_BUTTON } from '../../buttons';
import { StatusLine } from '../../status-line';
import { submitByHand } from '../../submit-by-hand';
import { deleteRepertoireAction, type DeleteState } from './actions';
import type { Holders, Repertoire } from './repertoire-types';

export function DeleteConfirm({
  id,
  name,
  assignedPlayers = 0,
  onCancel,
}: Repertoire & Holders & { readonly onCancel: () => void }): JSX.Element {
  const t = useTranslations();
  const cancel = useRef<HTMLButtonElement>(null);
  const [state, action, pending] = useActionState<DeleteState, FormData>(
    deleteRepertoireAction,
    {},
  );
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <form
      onSubmit={submitByHand(action)}
      className="flex w-full flex-col gap-2"
    >
      <input type="hidden" name="repertoireId" value={id} />
      <p>{t('repertoires.manage.deleteQuestion', { name })}</p>
      {assignedPlayers === 0 ? null : (
        <p>
          {t('assignment.deleteHolders', {
            count: assignedPlayers,
            days: FORK_OFFER_DAYS,
          })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={DANGER_BUTTON}>
          {t('repertoires.manage.deleteConfirm')}
        </button>
        <button
          ref={cancel}
          type="button"
          onClick={onCancel}
          className={SECONDARY_BUTTON}
        >
          {t('repertoires.manage.deleteCancel')}
        </button>
      </div>
      <StatusLine
        text={state.refusal === undefined ? null : t(state.refusal)}
        tone="error"
      />
    </form>
  );
}
