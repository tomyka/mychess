'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type JSX } from 'react';
import { SECONDARY_BUTTON } from '../buttons';
import { FIELD } from '../fields';
import { StatusLine } from '../status-line';

/**
 * An invite link just made, shown once with a Copy button (plan decision
 * 5): after a new invite, and after a new group with its invite (R-204).
 */
export function FreshLink({ link }: { readonly link: string }): JSX.Element {
  const t = useTranslations('coach.invites');
  const fieldId = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="font-medium">
        {t('link')}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={fieldId}
          type="text"
          readOnly
          value={link}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          className={`${FIELD} grow`}
        />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(link).then(() => {
              setCopied(true);
            });
          }}
          className={SECONDARY_BUTTON}
        >
          {t('copy')}
        </button>
      </div>
      <p className="text-fg-muted">{t('linkOnce')}</p>
      <StatusLine text={copied ? t('copied') : null} tone="success" />
    </div>
  );
}
