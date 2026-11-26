'use client';

import { useTranslations } from 'next-intl';
import {
  useId,
  type DragEvent,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../buttons';
import { SECTION, SECTION_TITLE } from '../../settings/styles';
import { SideField } from '../side-field';
import { StepNumber } from './step-number';
import type { ChosenView, FileStepView } from './use-import-flow';

const ACCEPT = '.pgn,application/x-chess-pgn,text/plain';

/** The file chooser: a real file input behind a dashed drop zone. */
function FileField({
  file,
  fileRef,
  onFile,
}: {
  readonly file: File | null;
  readonly fileRef: RefObject<HTMLInputElement | null>;
  readonly onFile: (file: File | null) => void;
}): JSX.Element {
  const t = useTranslations('repertoires.import');
  const id = useId();
  const drop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    onFile(event.dataTransfer.files[0] ?? null);
  };
  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={drop}
        className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed border-border-strong p-4 has-focus-visible:ring-2 has-focus-visible:ring-accent"
      >
        <input
          ref={fileRef}
          id={id}
          type="file"
          accept={ACCEPT}
          onChange={(event) => {
            onFile(event.currentTarget.files?.[0] ?? null);
          }}
          className="sr-only"
        />
        <label htmlFor={id} className={`${SECONDARY_BUTTON} cursor-pointer`}>
          {t('file')}
        </label>
        <p className="hidden text-sm text-fg-muted sm:block">{t('fileHint')}</p>
      </div>
      {file === null ? null : (
        <p className="text-sm">
          {t('fileChosen', {
            name: file.name,
            size: Math.ceil(file.size / 1024),
          })}
        </p>
      )}
    </div>
  );
}

/** The PGN pasted instead of a file (R-209); typing in it drops the file. */
function PasteField({
  pasted,
  onPaste,
}: {
  readonly pasted: string;
  readonly onPaste: (text: string) => void;
}): JSX.Element {
  const t = useTranslations('repertoires.import');
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {t('paste')}
      </label>
      {/* text-base on the phone: a smaller font makes iOS zoom in on focus. */}
      <textarea
        id={id}
        value={pasted}
        rows={6}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event) => {
          onPaste(event.currentTarget.value);
        }}
        className="min-h-32 w-full rounded-control border border-border-strong bg-surface px-3 py-2 font-mono text-base text-fg sm:text-sm"
      />
    </div>
  );
}

export interface FileStepProps {
  readonly step: FileStepView;
  /** The step's status line. */
  readonly status: ReactNode;
}

/** Step 1: the file or pasted PGN, and the side it is a repertoire for. */
export function FileStep({ step, status }: FileStepProps): JSX.Element {
  const t = useTranslations('repertoires.import');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        <StepNumber n={1} />
        {t('fileTitle')}
      </h2>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          step.onSubmit();
        }}
        className="flex flex-col gap-4"
      >
        <FileField
          file={step.file}
          fileRef={step.fileRef}
          onFile={step.onFile}
        />
        <PasteField pasted={step.pasted} onPaste={step.onPaste} />
        <SideField held={step.side} />
        <button
          type="submit"
          disabled={step.pending}
          className={`${PRIMARY_BUTTON} w-full sm:w-auto sm:self-start`}
        >
          {t('preview')}
        </button>
        {status}
      </form>
    </section>
  );
}

/**
 * Step 1 once previewed: the file (or "Pasted PGN") and side on one line,
 * with "Change".
 */
export function ChosenFile({ name, side, onChange }: ChosenView): JSX.Element {
  const t = useTranslations('repertoires');
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
      <p className="min-w-0 truncate font-medium">
        <StepNumber n={1} />
        {t('import.chosen', {
          name: name ?? t('import.pasted'),
          side: t(`create.${side}`),
        })}
      </p>
      <button type="button" onClick={onChange} className={SECONDARY_BUTTON}>
        {t('import.change')}
      </button>
    </div>
  );
}
