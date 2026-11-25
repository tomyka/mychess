'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState, type JSX, type RefObject } from 'react';
import { importIntoRoute, repertoireExportRoute } from '../../../lib/routes';
import { SECONDARY_BUTTON } from '../../buttons';
import { StatusLine } from '../../status-line';
import { DeleteConfirm } from './delete-confirm';
import { RenameForm } from './rename-form';
import type { Holders, Repertoire } from './repertoire-header-types';

export type Step = 'idle' | 'renaming' | 'renamed' | 'deleting';

/** Puts focus back on the button that opened a closed step. */
export function useReturnFocus(step: Step): {
  rename: RefObject<HTMLButtonElement | null>;
  remove: RefObject<HTMLButtonElement | null>;
  from: RefObject<Step>;
} {
  const rename = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  const from = useRef<Step>(step);
  useEffect(() => {
    if (step !== 'renaming' && from.current === 'renaming')
      rename.current?.focus();
    if (step === 'idle' && from.current === 'deleting') remove.current?.focus();
    from.current = step;
  }, [step]);
  return { rename, remove, from };
}

/** Rename, download, add from PGN and delete, as one wrapping row. */
function ActionButtons({
  id,
  focus,
  renameRef,
  onRename,
  onDelete,
}: {
  readonly id: string;
  readonly focus: ReturnType<typeof useReturnFocus>;
  readonly renameRef: RefObject<HTMLButtonElement | null>;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires.header');
  return (
    <div className="flex flex-wrap gap-2">
      <button
        ref={renameRef}
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

/** Where Rename opens its field when not in place of the buttons. */
export interface RenameElsewhere {
  /** Opens the field (the header's: in place of the h1). */
  readonly onRename: () => void;
  /** The Rename button, for focus to return to when the field closes. */
  readonly renameRef: RefObject<HTMLButtonElement | null>;
}

/**
 * The repertoire's own actions (docs/design/repertoire-screen.md): rename,
 * download PGN, add from PGN and delete, the last two-step and inline.
 * Shown in the header on a desktop and in the panel on a phone. Rename
 * opens in place of the buttons, unless `elsewhere` says where it opens.
 */
export function RepertoireActions({
  id,
  name,
  assignedPlayers,
  elsewhere,
}: Repertoire &
  Holders & {
    readonly elsewhere?: RenameElsewhere;
  }): JSX.Element {
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
    return (
      <DeleteConfirm
        id={id}
        name={name}
        assignedPlayers={assignedPlayers}
        onCancel={idle}
      />
    );
  return (
    <div className="flex flex-col gap-2">
      <ActionButtons
        id={id}
        focus={focus}
        renameRef={elsewhere?.renameRef ?? focus.rename}
        onRename={
          elsewhere?.onRename ??
          (() => {
            setStep('renaming');
          })
        }
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
