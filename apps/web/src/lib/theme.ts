/**
 * The colour theme a person picks in the account menu (#381): the system's,
 * or light or dark whatever the system says. Kept in a cookie so the server
 * renders the right theme on the first paint (tokens.css reads
 * `data-theme` on <html>).
 */
import { z } from 'zod';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** The cookie that holds the choice; a year long, readable by the page. */
export const THEME_COOKIE = 'theme';
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const themeSchema = z.enum(THEMES).catch('system');

/** A cookie value as a theme; anything unknown is the system's. */
export const parseTheme = (value: string | undefined): Theme =>
  themeSchema.parse(value);

/** The `data-theme` attribute for a theme: none follows the system. */
export const themeAttribute = (theme: Theme): 'light' | 'dark' | undefined =>
  theme === 'system' ? undefined : theme;
