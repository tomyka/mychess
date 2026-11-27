'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type JSX } from 'react';
import { QUIET_ACTION } from '../../../../../buttons';
import { PEN_GLYPH } from '../../../../../repertoire-view';
import { Sheet } from '../../../../../sheet';
import {
  CoachNoteFields,
  DeleteNoteButton,
  useCoachNote,
  useDoneText,
  useNoteWords,
  type CoachNoteOnMoveProps,
  type NoteDone,
} from './coach-note-form';

/**
 * The sheet's content, mounted while it is open, so each opening starts
 * from the saved note: the label naming the move and who sees it, the
 * field, Save and Delete, and Close.
 */
function SheetBody({
  onClose,
  onDone,
  ...props
}: CoachNoteOnMoveProps & {
  readonly onClose: () => void;
  readonly onDone: (done: NoteDone) => void;
}): JSX.Element {
  const t = useTranslations('coach.shared');
  const labelId = useId();
  const words = useNoteWords(props);
  const note = useCoachNote({ ...props, onDone });
  return (
    <>
      <p id={labelId} className="text-sm text-fg-muted">
        {words.label}
      </p>
      <CoachNoteFields note={note} labelledBy={labelId}>
        <DeleteNoteButton note={note} />
        <button type="button" onClick={onClose} className={QUIET_ACTION}>
          {t('close')}
        </button>
      </CoachNoteFields>
    </>
  );
}

/**
 * The sheet's open state, and what the strip says once a save or delete
 * closed it: the sheet's own status line goes with the sheet, and the page
 * behind a modal sheet is inert, so the strip's polite line says it after
 * the sheet has closed.
 */
function useNoteSheet(): {
  readonly open: boolean;
  readonly said: string;
  readonly show: () => void;
  readonly close: () => void;
  readonly done: (done: NoteDone) => void;
} {
  const doneText = useDoneText();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState('');
  const pending = useRef<string | null>(null);
  useEffect(() => {
    // After the Sheet's own effect (a child's runs first) closed the dialog.
    if (open || pending.current === null) return;
    const text = pending.current;
    pending.current = null;
    setSaid(text);
  }, [open]);
  return {
    open,
    said,
    show: () => {
      setSaid('');
      setOpen(true);
    },
    close: () => {
      setOpen(false);
    },
    done: (done) => {
      pending.current = doneText(done);
      setOpen(false);
    },
  };
}

/**
 * The coach's own note on the current move below `lg`, where the frame is
 * one column (docs/design/coach-shared-repertoire.md, Height budget): one
 * 44px row under the comment strip that is one button: the pen, the note
 * on one line, and Edit (or Add a note). It opens the app's bottom sheet
 * (Sheet), "Coach note", which overlays the page and moves nothing;
 * closing it (Close, Escape, or a save) returns focus to the strip.
 */
export function CoachNoteStrip(props: CoachNoteOnMoveProps): JSX.Element {
  const t = useTranslations('coach.shared');
  const titleId = useId();
  const strip = useRef<HTMLButtonElement>(null);
  const words = useNoteWords(props);
  const sheet = useNoteSheet();
  return (
    <div className="lg:hidden">
      <button
        ref={strip}
        type="button"
        aria-label={t(words.empty ? 'addNoteOn' : 'editNoteOn', {
          move: props.move,
        })}
        onClick={sheet.show}
        className="flex min-h-touch w-full items-center gap-2 px-gutter text-left text-sm"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-4 shrink-0 text-fg-muted"
          fill="currentColor"
        >
          <path d={PEN_GLYPH} />
        </svg>
        <span className="line-clamp-1 min-w-0 flex-1 break-words">
          {props.note}
        </span>
        <span className="shrink-0 font-semibold text-accent">
          {words.empty ? t('addNote') : t('editNote')}
        </span>
      </button>
      <p role="status" className="sr-only">
        {sheet.said}
      </p>
      <Sheet
        open={sheet.open}
        onClose={sheet.close}
        titleId={titleId}
        returnFocusRef={strip}
      >
        <div className="flex flex-col gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {t('noteTitle')}
          </h2>
          <SheetBody {...props} onClose={sheet.close} onDone={sheet.done} />
        </div>
      </Sheet>
    </div>
  );
}
