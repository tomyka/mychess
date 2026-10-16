// The settings page's shared class names: one card per section.

export const SECTION =
  'flex flex-col gap-4 sm:rounded-card sm:border sm:border-border sm:bg-surface sm:p-6 sm:shadow-card';

export const SECTION_TITLE = 'text-xl font-bold';

const BUTTON =
  'inline-flex min-h-touch items-center justify-center rounded-control px-4 py-2 text-base font-semibold disabled:opacity-60';

export const PRIMARY_BUTTON = `${BUTTON} bg-accent text-accent-fg`;

export const SECONDARY_BUTTON = `${BUTTON} border border-border-strong bg-surface text-fg`;

export const DANGER_BUTTON = `${BUTTON} bg-error text-on-state disabled:cursor-not-allowed`;
