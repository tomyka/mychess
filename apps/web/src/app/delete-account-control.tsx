'use client';

import type { DeletableAccount } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type JSX } from 'react';
import { DANGER_ROW, QUIET_ACTION, QUIET_BUTTON } from './buttons';
import { DeleteAccountForm } from './delete-account-form';
import { SECTION_TITLE } from './surfaces';
import { Sheet } from './sheet';

/** Where the control sits: a row of Settings' Your data, or under welcome's card. */
export type DeleteAccountVariant = 'row' | 'link';

const LOOKS: Record<DeleteAccountVariant, string> = {
  row: DANGER_ROW,
  link: QUIET_BUTTON,
};

/**
 * "Delete account…" (#381 part 6): a button that opens the delete form in
 * a sheet, a bottom sheet on a phone and a dialog from md, so the form
 * never opens in the page and moves it. Opening focuses the confirmation
 * field, past the export link before it (#403); Cancel or Escape closes
 * it, focus back on the button. The confirmation is the form's, unchanged
 * (R-82, R-86, R-95).
 */
export function DeleteAccountControl({
  account,
  canExport,
  variant,
}: {
  readonly account: DeletableAccount;
  readonly canExport: boolean;
  readonly variant: DeleteAccountVariant;
}): JSX.Element {
  const t = useTranslations('settings.delete');
  const titleId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className={LOOKS[variant]}
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('open')}
      </button>
      <Sheet
        open={open}
        onClose={close}
        titleId={titleId}
        returnFocusRef={button}
        initialFocusRef={field}
      >
        <div className="flex flex-col gap-4">
          <h2 id={titleId} className={`${SECTION_TITLE} text-error`}>
            {t('title')}
          </h2>
          <DeleteAccountForm
            account={account}
            canExport={canExport}
            fieldRef={field}
          />
          <button
            type="button"
            className={`${QUIET_ACTION} self-start`}
            onClick={close}
          >
            {t('cancel')}
          </button>
        </div>
      </Sheet>
    </>
  );
}
