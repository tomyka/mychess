'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useRef, useState, type JSX, type ReactNode } from 'react';
import { ROUTES } from '../../lib/routes';
import { PRIMARY_BUTTON, QUIET_ACTION, SECONDARY_BUTTON } from '../buttons';
import { SECTION, SECTION_TITLE } from '../settings/styles';
import { PageHeader } from '../shell/page-header';
import { CreateForm } from './create-form';

/** The create form, opened under the header, with its way out. */
function CreateSection({
  id,
  onCancel,
}: {
  readonly id: string;
  readonly onCancel: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires');
  const titleId = useId();
  return (
    <section id={id} aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('create.title')}
      </h2>
      <CreateForm />
      <button
        type="button"
        onClick={onCancel}
        className={`${QUIET_ACTION} self-start`}
      >
        {t('list.cancel')}
      </button>
    </section>
  );
}

/**
 * My repertoires' header (spec "My repertoires"): the title with Import PGN
 * and New at its right. New opens the create form under the header,
 * pushing the list down; Cancel closes it and gives the focus back to New.
 * An account with no repertoire at all sees it open (`startOpen`).
 */
export function NewRepertoire({
  startOpen,
  children,
}: {
  readonly startOpen: boolean;
  /** What sits between the header and the form: a notice, the empty line. */
  readonly children?: ReactNode;
}): JSX.Element {
  const t = useTranslations('repertoires.list');
  const [open, setOpen] = useState(startOpen);
  const formId = useId();
  const newRef = useRef<HTMLButtonElement>(null);
  const close = (): void => {
    setOpen(false);
    newRef.current?.focus();
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <PageHeader title={t('title')} />
          </div>
          <div className="flex gap-2">
            <Link href={ROUTES.repertoireImport} className={SECONDARY_BUTTON}>
              {t('import')}
            </Link>
            <button
              ref={newRef}
              type="button"
              aria-expanded={open}
              aria-controls={formId}
              onClick={() => {
                setOpen(!open);
              }}
              className={PRIMARY_BUTTON}
            >
              {t('new')}
            </button>
          </div>
        </div>
        <p className="text-fg-muted">{t('intro')}</p>
      </div>
      {children}
      {open ? <CreateSection id={formId} onCancel={close} /> : null}
    </div>
  );
}
