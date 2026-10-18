'use client';

import type { Side } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useId, type JSX, type ReactNode } from 'react';
import type { ImportTarget } from '../../../server/import-preview';
import { SECTION_TITLE } from '../../nustatymai/styles';
import { StepNumber } from './file-step';
import type { ImportOption, TargetChoice } from './use-import-flow';

const CHOICE =
  'flex min-h-touch cursor-pointer items-center gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60';

const CARD =
  'flex flex-col gap-3 rounded-control border border-border-strong bg-surface px-3 py-2 has-checked:border-accent has-checked:ring-1 has-checked:ring-accent';

const FIELD =
  'min-h-touch w-full rounded-control border border-border-strong bg-surface px-3 text-base text-fg aria-invalid:border-error';

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
  return (
    <div className={CARD}>
      <label className={CHOICE}>
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
        className={FIELD}
      />
    </div>
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
        className={FIELD}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      {added?.id === id ? (
        <p>
          {t('added', {
            chapters: added.added.chapters,
            moves: added.added.moves,
            name: added.name,
          })}
        </p>
      ) : null}
    </div>
  );
}

export interface TargetStepProps {
  /** The account's repertoires of the upload's side. */
  readonly options: readonly ImportOption[];
  readonly side: Side;
  readonly target: TargetChoice;
  readonly name: string;
  readonly nameInvalid: boolean;
  readonly statusId: string;
  /** The repertoire the shown preview was merged into, if any. */
  readonly added: ImportTarget | null;
  readonly onTarget: (target: TargetChoice) => void;
  readonly onName: (name: string) => void;
}

/** Step 3: a new repertoire with a name, or one of the side's repertoires (R-101). */
export function TargetStep(props: TargetStepProps): JSX.Element {
  const t = useTranslations('repertoires');
  const titleId = useId();
  const { options, target } = props;
  const first = options[0];
  const choose = (id: string): void => {
    props.onTarget({ kind: 'existing', id });
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
          props.onTarget({ kind: 'new' });
        }}
      >
        {target.kind === 'new' ? (
          <NameField
            name={props.name}
            invalid={props.nameInvalid}
            statusId={props.statusId}
            onName={props.onName}
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
            {t(props.side === 'white' ? 'list.emptyWhite' : 'list.emptyBlack')}
          </p>
        ) : null}
        {target.kind === 'existing' ? (
          <ExistingField
            id={target.id}
            options={options}
            added={props.added}
            onChoose={choose}
          />
        ) : null}
      </Choice>
    </section>
  );
}
