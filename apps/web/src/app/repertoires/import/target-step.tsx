'use client';

import { useTranslations } from 'next-intl';
import { useId, type JSX, type ReactNode } from 'react';
import type { ImportTarget } from '../../../server/import-preview';
import { FIELD, RADIO_CARD } from '../../fields';
import { SECTION_TITLE } from '../../settings/styles';
import { StepNumber } from './step-number';
import type { ImportOption } from './import-flow-state';
import type { TargetView } from './use-import-flow';

const CHOICE =
  'flex min-h-touch cursor-pointer items-center gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60';

const CARD = `${RADIO_CARD} flex flex-col gap-3 px-3 py-2`;

const WIDE_FIELD = `${FIELD} w-full`;

function Choice({
  label,
  checked,
  disabled,
  onChoose,
  children,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChoose: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={CARD}>
      <label id={labelId} className={CHOICE}>
        <input
          type="radio"
          name="target"
          checked={checked}
          disabled={disabled}
          onChange={onChoose}
          className="size-5 accent-accent"
        />
        {label}
      </label>
      {children}
    </div>
  );
}

function NameField({
  name,
  invalid,
  statusId,
  onName,
}: {
  readonly name: string;
  readonly invalid: boolean;
  readonly statusId: string;
  readonly onName: (name: string) => void;
}): JSX.Element {
  const t = useTranslations('repertoires.import');
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-medium">
        {t('name')}
      </label>
      <input
        id={id}
        type="text"
        value={name}
        autoComplete="off"
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? statusId : undefined}
        onChange={(event) => {
          onName(event.currentTarget.value);
        }}
        className={WIDE_FIELD}
      />
    </div>
  );
}

/**
 * What a merge adds to the chosen repertoire: its new chapters and moves,
 * when there are any, and the moves already there that gain a comment or
 * NAGs (R-176), when there are any.
 */
function AddedLines({
  target,
}: {
  readonly target: ImportTarget;
}): JSX.Element {
  const t = useTranslations('repertoires.import');
  const { chapters, moves, annotated } = target.added;
  return (
    <>
      {chapters + moves === 0 ? null : (
        <p>{t('added', { chapters, moves, name: target.name })}</p>
      )}
      {annotated === 0 ? null : (
        <p>{t('addedAnnotations', { count: annotated })}</p>
      )}
    </>
  );
}

function ExistingField({
  id,
  options,
  added,
  onChoose,
}: {
  readonly id: string;
  readonly options: readonly ImportOption[];
  /** What the merge into `id` adds, or null to say nothing. */
  readonly added: ImportTarget | null;
  readonly onChoose: (id: string) => void;
}): JSX.Element {
  const t = useTranslations('repertoires.import');
  const selectId = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={selectId} className="font-medium">
        {t('existing')}
      </label>
      <select
        id={selectId}
        value={id}
        onChange={(event) => {
          onChoose(event.currentTarget.value);
        }}
        className={WIDE_FIELD}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      {added === null ? null : <AddedLines target={added} />}
    </div>
  );
}

export interface TargetStepProps {
  readonly step: TargetView;
  /** The status line, which describes the name field when it is refused. */
  readonly statusId: string;
}

/** Step 3: a new repertoire with a name, or one of the side's repertoires (R-101). */
export function TargetStep({ step, statusId }: TargetStepProps): JSX.Element {
  const t = useTranslations('repertoires');
  const titleId = useId();
  const { options, target } = step;
  const first = options[0];
  const choose = (id: string): void => {
    step.onTarget({ kind: 'existing', id });
  };
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className={SECTION_TITLE}>
        <StepNumber n={3} />
        {t('import.targetTitle')}
      </h2>
      <Choice
        label={t('import.targetNew')}
        checked={target.kind === 'new'}
        disabled={false}
        onChoose={() => {
          step.onTarget({ kind: 'new' });
        }}
      >
        {target.kind === 'new' ? (
          <NameField
            name={step.name}
            invalid={step.nameInvalid}
            statusId={statusId}
            onName={step.onName}
          />
        ) : null}
      </Choice>
      <Choice
        label={t('import.targetExisting')}
        checked={target.kind === 'existing'}
        disabled={first === undefined}
        onChoose={() => {
          if (first !== undefined) choose(first.id);
        }}
      >
        {first === undefined ? (
          <p className="text-sm text-fg-muted">
            {t(step.side === 'white' ? 'list.emptyWhite' : 'list.emptyBlack')}
          </p>
        ) : null}
        {target.kind === 'existing' ? (
          <ExistingField
            id={target.id}
            options={options}
            added={step.added}
            onChoose={choose}
          />
        ) : null}
      </Choice>
    </section>
  );
}
