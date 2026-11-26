'use client';

import { SIDES, type Side } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

const CHOICE =
  'flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-border-strong bg-surface px-3 has-checked:border-accent has-checked:bg-sunken has-checked:ring-1 has-checked:ring-accent has-disabled:cursor-not-allowed has-disabled:opacity-60';

/** The side shown and what choosing another does: a held choice. */
export interface HeldSide {
  readonly side: Side;
  /** Only this side may be chosen (the import opened from a repertoire). */
  readonly fixed: boolean;
  readonly onSide: (side: Side) => void;
}

/**
 * White or Black, as two radio cards named `side` (the LanguageField
 * pattern), for New and the import. Given `held`, it shows and reports that
 * choice; without, it is a form field that starts on White.
 */
export function SideField({ held }: { readonly held?: HeldSide }): JSX.Element {
  const t = useTranslations('repertoires.create');
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">{t('side')}</legend>
      <div className="grid grid-cols-2 gap-3">
        {SIDES.map((value) => (
          <label key={value} className={CHOICE}>
            <input
              type="radio"
              name="side"
              value={value}
              {...(held === undefined
                ? { defaultChecked: value === 'white' }
                : {
                    checked: value === held.side,
                    disabled: held.fixed && value !== held.side,
                    onChange: () => {
                      held.onSide(value);
                    },
                  })}
              className="size-5 accent-accent"
            />
            {t(value)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
