'use client';

import type { Chapter, Standing } from '@mychess/chess';
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
import { isMessageKey } from '../../i18n/message-key';
import { DANGER_BUTTON, SECONDARY_BUTTON } from '../buttons';
import { FIELD } from '../fields';
import { StandingLine } from '../standing-line';
import { StatusLine } from '../status-line';
import type { FieldOutcome } from './field-save';

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
  /** What the row shows: told apart from a chapter of the same name (R-158). */
  readonly title: string;
  /** Its own name without that distinction, which renaming starts from. */
  readonly name: string;
  readonly onChoose: (chapterId: string) => void;
  readonly builder: ChapterBuilder | undefined;
  /** The chapter's standing, for a player who trains it (R-225). */
  readonly standing?: Standing | undefined;
}

const ROW =
  'flex min-h-touch w-full flex-col justify-center gap-1 rounded-control px-3 py-2 text-left aria-current:bg-sunken aria-current:font-semibold';

type Step = 'idle' | 'renaming' | 'deleting';
/** Where focus returns when a rename or confirmation closes. */
type Back = 'rename' | 'delete';

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
  name: initial,
  builder,
  onDone,
}: {
  readonly chapterId: string;
  /** The chapter's own name, without any distinction (R-158). */
  readonly name: string;
  readonly builder: ChapterBuilder;
  readonly onDone: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires.chapters');
  const fieldId = useId();
  const statusId = useId();
  const [name, setName] = useState(initial);
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
        className={FIELD}
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

/**
 * The current chapter's Rename chapter and Delete chapter, labelled, under
 * its title (spec, Builder), so titles do not squeeze beside icons.
 */
function RowEdits({
  disabled,
  refs,
  onStep,
}: {
  readonly disabled: boolean;
  readonly refs: Readonly<Record<Back, RefObject<HTMLButtonElement | null>>>;
  readonly onStep: (step: Step) => void;
}): JSX.Element {
  const t = useTranslations('repertoires.chapters');
  return (
    <div className="flex flex-wrap gap-2 px-3 pb-2">
      <button
        ref={refs.rename}
        type="button"
        disabled={disabled}
        onClick={() => {
          onStep('renaming');
        }}
        className={SECONDARY_BUTTON}
      >
        {t('renameShort')}
      </button>
      <button
        ref={refs.delete}
        type="button"
        disabled={disabled}
        onClick={() => {
          onStep('deleting');
        }}
        className={SECONDARY_BUTTON}
      >
        {t('deleteShort')}
      </button>
    </div>
  );
}

/**
 * The chapter's title in full (R-158), then its standing when given:
 * choosing it selects the chapter; the chosen one is current.
 */
function ChooseButton({
  current,
  title,
  standing,
  onChoose,
}: {
  readonly current: boolean;
  readonly title: string;
  readonly standing: Standing | undefined;
  readonly onChoose: () => void;
}): JSX.Element {
  const standingId = useId();
  // Named by its title alone; the standing describes it.
  return (
    <button
      type="button"
      aria-current={current ? 'true' : undefined}
      aria-label={title}
      aria-describedby={standing === undefined ? undefined : standingId}
      onClick={onChoose}
      className={ROW}
    >
      <span className="min-w-0 break-words">{title}</span>
      {standing === undefined ? null : (
        <span id={standingId}>
          <StandingLine standing={standing} due={standing.counts.due} />
        </span>
      )}
    </button>
  );
}

/**
 * One chapter of the list: choosing it selects it; with a standing it
 * shows the chapter's progress (R-225). No icons while browsing (spec,
 * Chapter line). In builder mode the current chapter renames in place and
 * deletes after an inline confirmation.
 */
export function ChapterRow(props: ChapterRowProps): JSX.Element {
  const { chapter, current, title, name, onChoose, builder, standing } = props;
  const { step, setStep, refs, closeTo } = useRowSteps();
  if (builder !== undefined && step === 'renaming')
    return (
      <RenameForm
        chapterId={chapter.id}
        name={name}
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
    <div className="flex flex-col">
      <ChooseButton
        current={current}
        title={title}
        standing={standing}
        onChoose={() => {
          onChoose(chapter.id);
        }}
      />
      {builder === undefined || !current ? null : (
        <RowEdits disabled={builder.disabled} refs={refs} onStep={setStep} />
      )}
    </div>
  );
}
