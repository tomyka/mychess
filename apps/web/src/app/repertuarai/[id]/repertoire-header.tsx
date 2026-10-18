'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  importIntoRoute,
  repertoireExportRoute,
  ROUTES,
} from '../../../lib/routes';
import { DANGER_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../buttons';
import { StatusLine } from '../../status-line';
import { submitByHand } from '../../submit-by-hand';
import {
  deleteRepertoireAction,
  renameRepertoireAction,
  type DeleteState,
  type RenameState,
} from './actions';

interface Repertoire {
  readonly id: string;
  readonly name: string;
}

const FIELD =
  'min-h-touch rounded-control border border-border-strong bg-surface px-3 text-base text-fg aria-invalid:border-error';

/** The rename action, telling `onDone` once a name is saved. */
function useRename(onDone: () => void) {
  return useActionState(async (previous: RenameState, form: FormData) => {
    const next = await renameRepertoireAction(previous, form);
    if (next.saved === true) onDone();
    return next;
  }, {});
}

function RenameForm({
  id,
  name,
  onDone,
  onCancel,
}: Repertoire & {
  readonly onDone: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const t = useTranslations();
  const fieldId = useId();
  const statusId = useId();
  const [state, action, pending] = useRename(onDone);
  const refused = state.refusal !== undefined;
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') onCancel();
  }
  return (
    <form
      noValidate
      onSubmit={submitByHand(action)}
      className="flex w-full flex-col gap-2"
    >
      <input type="hidden" name="repertoireId" value={id} />
      <label htmlFor={fieldId} className="font-medium">
        {t('repertoires.header.renameLabel')}
      </label>
      <input
        id={fieldId}
        type="text"
        name="name"
        autoComplete="off"
        defaultValue={name}
        autoFocus
        onKeyDown={onKeyDown}
        aria-invalid={refused ? true : undefined}
        aria-describedby={refused ? statusId : undefined}
        className={FIELD}
      />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {t('repertoires.header.renameSubmit')}
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          {t('repertoires.header.renameCancel')}
        </button>
      </div>
      <StatusLine
        id={statusId}
        text={state.refusal === undefined ? null : t(state.refusal)}
        tone="error"
      />
    </form>
  );
}

function DeleteConfirm({
  id,
  name,
  onCancel,
}: Repertoire & { readonly onCancel: () => void }): JSX.Element {
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
      <p>{t('repertoires.header.deleteQuestion', { name })}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={DANGER_BUTTON}>
          {t('repertoires.header.deleteConfirm')}
        </button>
        <button
          ref={cancel}
          type="button"
          onClick={onCancel}
          className={SECONDARY_BUTTON}
        >
          {t('repertoires.header.deleteCancel')}
        </button>
      </div>
      <StatusLine
        text={state.refusal === undefined ? null : t(state.refusal)}
        tone="error"
      />
    </form>
  );
}

type Step = 'idle' | 'renaming' | 'renamed' | 'deleting';

/** Puts focus back on the button that opened a closed step. */
function useReturnFocus(step: Step): {
  rename: RefObject<HTMLButtonElement | null>;
  remove: RefObject<HTMLButtonElement | null>;
  from: RefObject<Step>;
} {
  const rename = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  const from = useRef<Step>(step);
  useEffect(() => {
    if (step === 'idle' && from.current === 'renaming') rename.current?.focus();
    if (step === 'idle' && from.current === 'deleting') remove.current?.focus();
    from.current = step;
  }, [step]);
  return { rename, remove, from };
}

/** Rename, download, add from PGN and delete, as one wrapping row. */
function ActionButtons({
  id,
  focus,
  onRename,
  onDelete,
}: {
  readonly id: string;
  readonly focus: ReturnType<typeof useReturnFocus>;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires.header');
  return (
    <div className="flex flex-wrap gap-2">
      <button
        ref={focus.rename}
        type="button"
        onClick={onRename}
        className={SECONDARY_BUTTON}
      >
        {t('rename')}
      </button>
      <a href={repertoireExportRoute(id)} download className={SECONDARY_BUTTON}>
        {t('download')}
      </a>
      <Link href={importIntoRoute(id)} className={SECONDARY_BUTTON}>
        {t('importInto')}
      </Link>
      <button
        ref={focus.remove}
        type="button"
        onClick={onDelete}
        className={`${SECONDARY_BUTTON} text-error`}
      >
        {t('delete')}
      </button>
    </div>
  );
}

/**
 * The repertoire's own actions (docs/design/repertoire-screen.md): rename,
 * download PGN, add from PGN and delete, the last two-step and inline.
 * Shown in the header on a desktop and in the panel on a phone.
 */
export function RepertoireActions({ id, name }: Repertoire): JSX.Element {
  const t = useTranslations('repertoires.header');
  const [step, setStep] = useState<Step>('idle');
  const focus = useReturnFocus(step);
  const idle = () => {
    setStep('idle');
  };
  if (step === 'renaming')
    return (
      <RenameForm
        id={id}
        name={name}
        onDone={() => {
          setStep('renamed');
        }}
        onCancel={idle}
      />
    );
  if (step === 'deleting')
    return <DeleteConfirm id={id} name={name} onCancel={idle} />;
  return (
    <div className="flex flex-col gap-2">
      <ActionButtons
        id={id}
        focus={focus}
        onRename={() => {
          setStep('renaming');
        }}
        onDelete={() => {
          setStep('deleting');
        }}
      />
      <StatusLine
        text={step === 'renamed' ? t('renamed') : null}
        tone="success"
      />
    </div>
  );
}

/**
 * The top bar on a phone (back, the name on one line, the mode switch) and
 * the header on a desktop (back link, the name, the actions, the switch).
 */
export function RepertoireHeader({
  id,
  name,
  children,
}: Repertoire & { readonly children?: ReactNode }): JSX.Element {
  const t = useTranslations('repertoires.header');
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-gutter py-1 lg:px-0 lg:py-0">
      <Link
        href={ROUTES.repertoires}
        className="inline-flex min-h-touch min-w-touch items-center gap-1 text-accent lg:basis-full lg:underline"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        <span className="max-lg:sr-only">{t('back')}</span>
      </Link>
      <h1
        title={name}
        className="min-w-0 flex-1 truncate text-lg font-semibold lg:flex-none lg:whitespace-normal lg:text-3xl lg:font-bold"
      >
        {name}
      </h1>
      <div className="hidden lg:flex">
        <RepertoireActions id={id} name={name} />
      </div>
      {children}
    </header>
  );
}
