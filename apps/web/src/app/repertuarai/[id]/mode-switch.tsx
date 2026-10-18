'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

export interface ModeSwitchProps {
  readonly building: boolean;
  readonly onChange: (building: boolean) => void;
}

/**
 * Browse or build (docs/design/repertoire-screen.md): a switch at the end of
 * the top bar, its state in `aria-checked` and in the knob's place.
 */
export function ModeSwitch({
  building,
  onChange,
}: ModeSwitchProps): JSX.Element {
  const t = useTranslations('repertoires.mode');
  return (
    <button
      type="button"
      role="switch"
      aria-checked={building}
      onClick={() => {
        onChange(!building);
      }}
      className="inline-flex min-h-touch items-center gap-2 rounded-control px-2 font-semibold"
    >
      <span>{t('build')}</span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-6 w-10 shrink-0 rounded-full border border-border-strong ${building ? 'bg-accent' : 'bg-sunken'}`}
      >
        <span
          className={`absolute top-0.5 size-4.5 rounded-full bg-surface shadow-card ${building ? 'right-0.5' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}
