'use client';

import { useTranslations } from 'next-intl';
import { useId, type JSX } from 'react';
import {
  THEMES,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  themeAttribute,
  type Theme,
} from '../../lib/theme';
import { useShellAccount } from './shell-context';

const LABEL = {
  system: 'themeSystem',
  light: 'themeLight',
  dark: 'themeDark',
} as const;

const OPTION =
  'flex min-h-touch flex-1 cursor-pointer items-center justify-center rounded-control px-2 text-sm has-focus-visible:ring-2 has-focus-visible:ring-focus';

/**
 * The chosen theme: the accent-subtle fill with an accent ring, as the
 * radio cards have it, so it reads in dark too (#381 part 6, finding 13).
 */
const CHOSEN = 'bg-accent-subtle font-semibold text-accent ring-2 ring-accent';

/** Applies a theme now and keeps it for the next visit (lead decision 4). */
function apply(theme: Theme): void {
  const attribute = themeAttribute(theme);
  const root = document.documentElement;
  if (attribute === undefined) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', attribute);
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${String(THEME_COOKIE_MAX_AGE)}; samesite=lax`;
}

/** System, light or dark (#381). */
export function ThemeSwitch(): JSX.Element | null {
  const t = useTranslations('nav.account');
  const account = useShellAccount();
  const name = useId();
  if (account === null) return null;
  const { theme, setTheme } = account;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="px-3 text-sm text-fg-muted">{t('theme')}</legend>
      <div className="flex gap-1 px-2">
        {THEMES.map((value) => (
          <label
            key={value}
            className={`${OPTION} ${theme === value ? CHOSEN : ''}`}
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={theme === value}
              onChange={() => {
                setTheme(value);
                apply(value);
              }}
              className="sr-only"
            />
            {t(LABEL[value])}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
