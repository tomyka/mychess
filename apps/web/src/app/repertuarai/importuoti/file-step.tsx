'use client';

import { SIDES, type Side } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import {
  useId,
  type DragEvent,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../buttons';
import { SECTION, SECTION_TITLE } from '../../nustatymai/styles';

const CHOICE =
  'flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-border-strong bg-surface px-3 has-checked:border-accent has-checked:bg-sunken has-checked:ring-1 has-checked:ring-accent has-disabled:cursor-not-allowed has-disabled:opacity-60';

const ACCEPT = '.pgn,application/x-chess-pgn,text/plain';

/** The step number before a step's title. */
export function StepNumber({ n }: { readonly n: number }): JSX.Element {
  return (
    <span aria-hidden="true" className="mr-2 tabular-nums text-fg-muted">
      {n}
    </span>
  );
}

/** White or Black, as two radio cards; opened from a repertoire, its side only. */
function SideField({
  side,
  fixed,
  onSide,
}: {
  readonly side: Side;
  readonly fixed: boolean;
  readonly onSide: (side: Side) => void;
}): JSX.Element {
  const t = useTranslations('repertoires');
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">{t('import.side')}</legend>
      <div className="grid grid-cols-2 gap-3">
        {SIDES.map((value) => (
          <label key={value} className={CHOICE}>
            <input
              type="radio"
              name="side"
              value={value}
              checked={value === side}
              disabled={fixed && value !== side}
              onChange={() => {
                onSide(value);
              }}
              className="size-5 accent-accent"
            />
            {t(`create.${value}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

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

export interface FileStepProps {
  readonly file: File | null;
  readonly side: Side;
  readonly sideFixed: boolean;
  readonly pending: boolean;
  readonly fileRef: RefObject<HTMLInputElement | null>;
  readonly onFile: (file: File | null) => void;
  readonly onSide: (side: Side) => void;
  readonly onSubmit: () => void;
  /** The step's status line. */
  readonly status: ReactNode;
}

/** Step 1: the file and the side it is a repertoire for. */
export function FileStep(props: FileStepProps): JSX.Element {
  const t = useTranslations('repertoires.import');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={`${SECTION} max-w-2xl`}>
      <h2 id={titleId} className={SECTION_TITLE}>
        <StepNumber n={1} />
        {t('fileTitle')}
      </h2>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
        className="flex flex-col gap-4"
      >
        <FileField
          file={props.file}
          fileRef={props.fileRef}
          onFile={props.onFile}
        />
        <SideField
          side={props.side}
          fixed={props.sideFixed}
          onSide={props.onSide}
        />
        <button
          type="submit"
          disabled={props.pending}
          className={`${PRIMARY_BUTTON} w-full sm:w-auto sm:self-start`}
        >
          {t('preview')}
        </button>
        {props.status}
      </form>
    </section>
  );
}

/** Step 1 once previewed: the file and side on one line, with "Change". */
export function ChosenFile({
  name,
  side,
  onChange,
}: {
  readonly name: string;
  readonly side: Side;
  readonly onChange: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires');
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
      <p className="min-w-0 truncate font-medium">
        <StepNumber n={1} />
        {t('import.chosen', { name, side: t(`create.${side}`) })}
      </p>
      <button type="button" onClick={onChange} className={SECONDARY_BUTTON}>
        {t('import.change')}
      </button>
    </div>
  );
}
