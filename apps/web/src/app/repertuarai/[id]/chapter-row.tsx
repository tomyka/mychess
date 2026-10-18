'use client';

import type { Chapter } from '@mychess/chess';
import { useMessages, useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type JSX,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { isMessageKey } from '../../../i18n/message-key';
import { DANGER_BUTTON, SECONDARY_BUTTON } from '../../buttons';
import { StatusLine } from '../../status-line';
import type { FieldOutcome } from './move-panel';

/** What the chapter list can change in builder mode. */
export interface ChapterBuilder {
  /** Saving, or the repertoire changed elsewhere. */
  readonly disabled: boolean;
  readonly onAdd: () => void;
  readonly onRename: (chapterId: string, name: string) => Promise<FieldOutcome>;
  readonly onDelete: (chapterId: string) => void;
}

export interface ChapterRowProps {
  readonly chapter: Chapter;
  readonly current: boolean;
  readonly title: string;
  readonly onChoose: (chapterId: string) => void;
  readonly builder: ChapterBuilder | undefined;
}

const ROW =
  'flex min-h-touch w-full items-center rounded-control px-3 text-left aria-current:bg-sunken aria-current:font-semibold';
const ICON =
  'inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-control disabled:opacity-60';

type Step = 'idle' | 'renaming' | 'deleting';
/** Where focus returns when a rename or confirmation closes. */
type Back = 'rename' | 'delete';

function Icon({ path }: { readonly path: string }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d={path} />
    </svg>
  );
}

const PENCIL = 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4';
const BIN = 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13';

/** Escape on a form element cancels it. */
const escapeCancels =
  (onCancel: () => void) =>
  (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') onCancel();
  };

/** The rename form's outcome text: the refusal's words, or a failure. */
function useRefusalText(refusal: string | null): string | null {
  const t = useTranslations();
  const messages = useMessages();
  if (refusal === null) return null;
  return isMessageKey(messages, refusal) ? t(refusal) : t('repertoires.failed');
}

/** Sends a rename; closes on success, keeps the refusal otherwise. */
function useRename(
  send: (name: string) => Promise<FieldOutcome>,
  onDone: () => void,
) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = (name: string): void => {
    startTransition(async () => {
      try {
        const outcome = await send(name);
        if (outcome.ok) onDone();
        else setRefusal(outcome.refusal);
      } catch {
        setRefusal('repertoires.failed');
      }
    });
  };
  return { refusal, pending, submit };
}

/** The row as a name field with Save and Cancel; Escape cancels. */
function RenameForm({
  chapterId,
  title,
  builder,
  onDone,
}: {
  readonly chapterId: string;
  readonly title: string;
  readonly builder: ChapterBuilder;
  readonly onDone: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires.chapters');
  const fieldId = useId();
  const statusId = useId();
  const [name, setName] = useState(title);
  const { refusal, pending, submit } = useRename(
    (typed) => builder.onRename(chapterId, typed),
    onDone,
  );
  const said = useRefusalText(refusal);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(name);
      }}
      onKeyDown={escapeCancels(onDone)}
      className="flex flex-col gap-2 px-3 py-2"
    >
      <label htmlFor={fieldId} className="sr-only">
        {t('renameLabel')}
      </label>
      <input
        id={fieldId}
        value={name}
        autoFocus
        onChange={(event) => {
          setName(event.target.value);
        }}
        aria-invalid={refusal === null ? undefined : true}
        aria-describedby={refusal === null ? undefined : statusId}
        className="min-h-touch rounded-control border border-border-strong bg-surface px-3 text-base text-fg aria-invalid:border-error"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || builder.disabled}
          className={SECONDARY_BUTTON}
        >
          {t('renameSubmit')}
        </button>
        <button type="button" onClick={onDone} className={SECONDARY_BUTTON}>
          {t('renameCancel')}
        </button>
      </div>
      <StatusLine id={statusId} text={said} tone="error" />
    </form>
  );
}

/** "Delete chapter {title}? ..." with Delete chapter and Cancel (focused). */
function DeleteConfirm({
  title,
  onDelete,
  onCancel,
}: {
  readonly title: string;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires.chapters');
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <div
      onKeyDown={escapeCancels(onCancel)}
      className="flex flex-col gap-2 px-3 py-2"
    >
      <p>{t('deleteQuestion', { title })}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onDelete} className={DANGER_BUTTON}>
          {t('deleteConfirm')}
        </button>
        <button
          ref={cancel}
          type="button"
          onClick={onCancel}
          className={SECONDARY_BUTTON}
        >
          {t('deleteCancel')}
        </button>
      </div>
    </div>
  );
}

/** Focuses the button a closed rename or confirmation came from. */
function useReturnFocus(
  back: Back | null,
  refs: Readonly<Record<Back, RefObject<HTMLButtonElement | null>>>,
): void {
  useEffect(() => {
    if (back !== null) refs[back].current?.focus();
  }, [back, refs]);
}

/** The row's step, and closing a step with focus back on its button. */
function useRowSteps() {
  const [step, setStep] = useState<Step>('idle');
  const [back, setBack] = useState<{ readonly to: Back } | null>(null);
  const rename = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  const [refs] = useState({ rename, delete: remove });
  useReturnFocus(back?.to ?? null, refs);
  const closeTo = (to: Back) => () => {
    setStep('idle');
    setBack({ to });
  };
  return { step, setStep, refs, closeTo };
}

/** The row's own Rename and Delete (44x44, named after the chapter). */
function RowEdits({
  title,
  disabled,
  refs,
  onStep,
}: {
  readonly title: string;
  readonly disabled: boolean;
  readonly refs: Readonly<Record<Back, RefObject<HTMLButtonElement | null>>>;
  readonly onStep: (step: Step) => void;
}): JSX.Element {
  const t = useTranslations('repertoires.chapters');
  return (
    <>
      <button
        ref={refs.rename}
        type="button"
        aria-label={t('rename', { title })}
        disabled={disabled}
        onClick={() => {
          onStep('renaming');
        }}
        className={ICON}
      >
        <Icon path={PENCIL} />
      </button>
      <button
        ref={refs.delete}
        type="button"
        aria-label={t('delete', { title })}
        disabled={disabled}
        onClick={() => {
          onStep('deleting');
        }}
        className={ICON}
      >
        <Icon path={BIN} />
      </button>
    </>
  );
}

/**
 * One chapter of the list: choosing it selects it; in builder mode it also
 * renames in place and deletes after an inline confirmation
 * (docs/design/repertoire-screen.md, Chapters in builder mode).
 */
export function ChapterRow({
  chapter,
  current,
  title,
  onChoose,
  builder,
}: ChapterRowProps): JSX.Element {
  const { step, setStep, refs, closeTo } = useRowSteps();
  if (builder !== undefined && step === 'renaming')
    return (
      <RenameForm
        chapterId={chapter.id}
        title={title}
        builder={builder}
        onDone={closeTo('rename')}
      />
    );
  if (builder !== undefined && step === 'deleting')
    return (
      <DeleteConfirm
        title={title}
        onDelete={() => {
          setStep('idle');
          builder.onDelete(chapter.id);
        }}
        onCancel={closeTo('delete')}
      />
    );
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        title={title}
        onClick={() => {
          onChoose(chapter.id);
        }}
        className={ROW}
      >
        <span className="line-clamp-2">{title}</span>
      </button>
      {builder === undefined ? null : (
        <RowEdits
          title={title}
          disabled={builder.disabled}
          refs={refs}
          onStep={setStep}
        />
      )}
    </div>
  );
}
