'use client';

import type { InviteTeaser } from '@mychess/db';
import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import { PRIMARY_BUTTON } from '../buttons';
import { EntryTitle } from '../entry-frame';
import { NameField } from '../profile-fields';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { completeOnboardingAction, type OnboardingState } from './actions';

export interface OnboardingFormProps {
  /** The name Google or Lichess gave, or empty (R-81). */
  readonly displayName: string;
  /**
   * The invite to go on to once onboarded (R-81), sent back as a hidden
   * field; the action checks it again, as it is client input.
   */
  readonly next?: string | null;
  /** The coach of the valid invite in `next` (R-235), or null. */
  readonly teaser?: InviteTeaser | null;
}

const INITIAL: OnboardingState = {};

/**
 * The one onboarding screen's card: a display name (R-81), and, from a
 * valid invite, whose invite comes next. The page puts it in the
 * EntryFrame.
 */
export function OnboardingForm({
  displayName,
  next = null,
  teaser = null,
}: OnboardingFormProps): JSX.Element {
  const t = useTranslations('onboarding');
  const errors = useTranslations();
  const statusId = useId();
  const [state, action, pending] = useActionState(
    completeOnboardingAction,
    INITIAL,
  );
  return (
    <>
      <header className="flex flex-col gap-2">
        <EntryTitle>{t('title')}</EntryTitle>
        <p className="text-fg-muted">{t('intro')}</p>
      </header>
      <StatusLine
        id={statusId}
        text={state.refusal === undefined ? null : errors(state.refusal)}
        tone="error"
      />
      {/* noValidate: the server's refusal is shown, not the browser's. */}
      <form
        noValidate
        onSubmit={submitByHand(action)}
        className="flex flex-col gap-6"
      >
        <NameField
          label={t('displayName')}
          hint={t('displayNameHint')}
          initial={displayName}
          invalid={state.refusal !== undefined}
          statusId={statusId}
        />
        {next === null ? null : (
          <input type="hidden" name="next" value={next} />
        )}
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {t('submit')}
        </button>
      </form>
      {teaser === null ? null : (
        <p className="text-fg-muted">
          {t('nextInvite', { coach: teaser.coachDisplayName })}
        </p>
      )}
    </>
  );
}
