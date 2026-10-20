'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import type { RepertoireSharing } from '../../../server/repertoires';
import { SECONDARY_BUTTON } from '../../buttons';
import { StatusLine } from '../../status-line';
import { submitByHand } from '../../submit-by-hand';
import { PANEL_LABEL } from '../../repertoire-view';
import { setSharesAction, type ShareState } from './sharing-actions';

/**
 * What the status line says: the refusal of the last save, else how many
 * coaches it is shared with, from the page until the first save.
 */
function useShareStatus(state: ShareState, before: number): string {
  const t = useTranslations();
  if (state.refusal !== undefined) return t(state.refusal);
  const shared = state.shared ?? before;
  return shared === 0
    ? t('share.notShared')
    : t('share.sharedWith', { count: shared });
}

/** Error for a refusal, success after a save, info before one. */
const statusTone = (state: ShareState): 'success' | 'error' | 'info' => {
  if (state.refusal !== undefined) return 'error';
  return state.shared === undefined ? 'info' : 'success';
};

/** The linked coaches as checkboxes, ticked where it is shared, and Save. */
function ShareForm({
  repertoireId,
  sharing,
}: {
  readonly repertoireId: string;
  readonly sharing: RepertoireSharing;
}): JSX.Element {
  const t = useTranslations('share');
  const [state, action, pending] = useActionState<ShareState, FormData>(
    setSharesAction,
    {},
  );
  const said = useShareStatus(state, sharing.sharedWith.length);
  return (
    <form onSubmit={submitByHand(action)} className="flex flex-col gap-2">
      <input type="hidden" name="repertoireId" value={repertoireId} />
      <fieldset className="flex flex-col">
        <legend className={PANEL_LABEL}>{t('coaches')}</legend>
        {sharing.coaches.map((coach) => (
          <label
            key={coach.id}
            className="flex min-h-touch items-center gap-3 text-base"
          >
            <input
              type="checkbox"
              name="coachIds"
              value={coach.id}
              defaultChecked={sharing.sharedWith.includes(coach.id)}
              className="size-5 accent-accent"
            />
            {coach.displayName}
          </label>
        ))}
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className={`${SECONDARY_BUTTON} self-start`}
      >
        {t('save')}
      </button>
      <StatusLine text={said} tone={statusTone(state)} />
    </form>
  );
}

/**
 * "Share with a coach" on the owner's repertoire (R-42): the linked
 * coaches as checkboxes with one Save; without a linked coach, why there
 * is nothing to tick.
 */
export function ShareWithCoach({
  repertoireId,
  sharing,
}: {
  readonly repertoireId: string;
  readonly sharing: RepertoireSharing;
}): JSX.Element {
  const t = useTranslations('share');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className={PANEL_LABEL}>
        {t('title')}
      </h2>
      {sharing.coaches.length === 0 ? (
        <p className="text-fg-muted">{t('noCoach')}</p>
      ) : (
        <>
          <p className="text-sm text-fg-muted">{t('intro')}</p>
          <ShareForm repertoireId={repertoireId} sharing={sharing} />
        </>
      )}
    </section>
  );
}
