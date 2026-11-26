'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import type { RepertoireSharing } from '../../../server/repertoires';
import { SECONDARY_BUTTON } from '../../buttons';
import { submitByHand } from '../../submit-by-hand';
import { PANEL_LABEL } from '../../repertoire-view';
import { SECTION_LOOK, type SectionLook } from '../section-look';
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

/** The status as plain text: muted, or the error colour for a refusal. */
const statusClass = (state: ShareState): string =>
  state.refusal === undefined ? 'text-fg-muted' : 'text-error';

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
      <p role="status" className={statusClass(state)}>
        {said}
      </p>
    </form>
  );
}

/**
 * "Share with a coach" on the owner's repertoire (R-42): the linked
 * coaches as checkboxes with one Save; nothing without a linked coach
 * (#331: a coach without a coach of their own has no one to share with).
 */
export function ShareWithCoach({
  repertoireId,
  sharing,
  look = 'panel',
}: {
  readonly repertoireId: string;
  readonly sharing: RepertoireSharing;
  readonly look?: SectionLook;
}): JSX.Element | null {
  const t = useTranslations('share');
  const titleId = useId();
  if (sharing.coaches.length === 0) return null;
  const { section, title } = SECTION_LOOK[look];
  return (
    <section aria-labelledby={titleId} className={section}>
      <h2 id={titleId} className={title}>
        {t('title')}
      </h2>
      <p className="text-sm text-fg-muted">{t('intro')}</p>
      <ShareForm repertoireId={repertoireId} sharing={sharing} />
    </section>
  );
}
