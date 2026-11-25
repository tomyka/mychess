'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type JSX, type ReactNode } from 'react';
import { ROUTES } from '../../../lib/routes';
import { StatusLine } from '../../status-line';
import { RenameForm } from './rename-form';
import {
  RepertoireActions,
  useReturnFocus,
  type RenameElsewhere,
  type Step,
} from './repertoire-actions';
import type { Holders, Repertoire } from './repertoire-header-types';

/**
 * The header's rename (desktop): the field takes the h1's place, and focus
 * goes back to Rename when it closes.
 */
function useHeaderRename() {
  const [step, setStep] = useState<Step>('idle');
  const focus = useReturnFocus(step);
  const elsewhere: RenameElsewhere = {
    onRename: () => {
      setStep('renaming');
    },
    renameRef: focus.rename,
  };
  return {
    step,
    elsewhere,
    done: () => {
      setStep('renamed');
    },
    cancel: () => {
      setStep('idle');
    },
  };
}

/** Back to My repertoires: an arrow on a phone, a text link on a desktop. */
function BackLink(): JSX.Element {
  const t = useTranslations('repertoires.header');
  return (
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
  );
}

/**
 * The top bar on a phone (back, the name on one line, the mode switch) and
 * the header on a desktop (back link, the name, the actions, the switch at
 * the right end). On a desktop Rename turns the h1 into the name field.
 */
export function RepertoireHeader({
  id,
  name,
  assignedPlayers,
  children,
}: Repertoire & Holders & { readonly children?: ReactNode }): JSX.Element {
  const t = useTranslations('repertoires.header');
  const rename = useHeaderRename();
  const renaming = rename.step === 'renaming';
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-gutter py-1 lg:px-0 lg:py-0">
      <BackLink />
      {renaming ? (
        <div className="hidden min-w-0 flex-1 lg:flex lg:max-w-xl">
          <RenameForm
            id={id}
            name={name}
            onDone={rename.done}
            onCancel={rename.cancel}
          />
        </div>
      ) : null}
      <h1
        title={name}
        className={`min-w-0 flex-1 truncate text-lg font-semibold lg:flex-none lg:whitespace-normal lg:text-3xl lg:font-bold ${renaming ? 'lg:hidden' : ''}`}
      >
        {name}
      </h1>
      <div
        className={renaming ? 'hidden' : 'hidden lg:flex lg:flex-col lg:gap-2'}
      >
        <RepertoireActions
          id={id}
          name={name}
          assignedPlayers={assignedPlayers}
          elsewhere={rename.elsewhere}
        />
        <StatusLine
          text={rename.step === 'renamed' ? t('renamed') : null}
          tone="success"
        />
      </div>
      <div className="lg:ml-auto">{children}</div>
    </header>
  );
}
