'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import { NameField } from '../profile-fields';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { updateProfileAction, type ProfileState } from './actions';
import { SaveRow } from './save-row';
import { SETTINGS_FIELD } from './styles';

export interface ProfileFormProps {
  readonly displayName: string;
}

const INITIAL: ProfileState = {};

/**
 * The display name, changed at any time: a block of Settings' Account
 * card, under its heading. A refusal shows above the field, "Saved" beside
 * Save.
 */
export function ProfileForm({ displayName }: ProfileFormProps): JSX.Element {
  const t = useTranslations();
  const statusId = useId();
  const [state, action, pending] = useActionState(updateProfileAction, INITIAL);
  const refused = state.refusal !== undefined;
  return (
    <div className="flex flex-col gap-4">
      <StatusLine
        id={statusId}
        text={state.refusal === undefined ? null : t(state.refusal)}
        tone="error"
      />
      {/* noValidate: the server's refusal is shown, not the browser's. */}
      <form
        noValidate
        onSubmit={submitByHand(action)}
        className="flex flex-col gap-4"
      >
        <div className={SETTINGS_FIELD}>
          <NameField
            label={t('settings.profile.displayName')}
            initial={displayName}
            invalid={refused}
            statusId={statusId}
          />
        </div>
        <SaveRow
          label={t('settings.profile.submit')}
          pending={pending}
          saved={!refused && state.saved === true}
        />
      </form>
    </div>
  );
}
