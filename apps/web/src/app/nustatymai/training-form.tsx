'use client';

import type { TrainingSettings } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import { PRIMARY_BUTTON } from '../buttons';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import {
  updateTrainingSettingsAction,
  type TrainingSettingsState,
} from './actions';
import { SECTION, SECTION_TITLE } from './styles';

const INITIAL: TrainingSettingsState = {};

/** The field names, as the form sends them and the refusals name them. */
type Field = keyof TrainingSettings;

/** A whole-number field with its label, its range, and a refusal mark. */
function LimitField({
  name,
  initial,
  min,
  max,
  invalid,
  statusId,
}: {
  readonly name: Field;
  readonly initial: number;
  readonly min: number;
  readonly max: number;
  readonly invalid: boolean;
  readonly statusId: string;
}): JSX.Element {
  const t = useTranslations('training.settings');
  const fieldId = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="font-semibold">
        {t(`${name}Label`)}
      </label>
      <input
        id={fieldId}
        name={name}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        defaultValue={initial}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? `${hintId} ${statusId}` : hintId}
        className="min-h-touch w-32 rounded-control border border-border-strong bg-surface px-3 text-base text-fg aria-invalid:border-error"
      />
      <p id={hintId} className="text-sm text-fg-muted">
        {t(`${name}Hint`)}
      </p>
    </div>
  );
}

/**
 * The player's training limits (R-62, R-146): reviews per session and new
 * moves a day. The server parses them with the domain's bounds; a refusal
 * marks its field and keeps what was typed.
 */
export function TrainingForm({
  settings,
}: {
  readonly settings: TrainingSettings;
}): JSX.Element {
  const t = useTranslations();
  const statusId = useId();
  const titleId = useId();
  const [state, action, pending] = useActionState(
    updateTrainingSettingsAction,
    INITIAL,
  );
  const saved = state.saved === true ? t('training.settings.saved') : null;
  const text = state.refusal === undefined ? saved : t(state.refusal);
  const invalid = (field: Field) =>
    state.refusal === `training.settings.${field}`;
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('training.settings.title')}
      </h2>
      <StatusLine
        id={statusId}
        text={text}
        tone={state.refusal === undefined ? 'success' : 'error'}
      />
      {/* noValidate: the server's refusal is shown in the page's language,
          not the browser's. */}
      <form
        noValidate
        onSubmit={submitByHand(action)}
        className="flex flex-col gap-6"
      >
        <LimitField
          name="sessionSize"
          initial={settings.sessionSize}
          min={10}
          max={100}
          invalid={invalid('sessionSize')}
          statusId={statusId}
        />
        <LimitField
          name="newPerDay"
          initial={settings.newPerDay}
          min={0}
          max={50}
          invalid={invalid('newPerDay')}
          statusId={statusId}
        />
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {t('training.settings.submit')}
        </button>
      </form>
    </section>
  );
}
