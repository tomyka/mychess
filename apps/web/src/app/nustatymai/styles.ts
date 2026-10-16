// The settings page's shared class names: one card per section on a wide
// screen; on a phone the sections are separated by a rule instead.

const SECTION_BASE =
  'flex flex-col gap-4 border-t pt-6 sm:rounded-card sm:border sm:bg-surface sm:p-6 sm:shadow-card';

export const SECTION = `${SECTION_BASE} border-border`;

/** The delete section: the same card, edged in the error colour (R-82). */
export const DANGER_SECTION = `${SECTION_BASE} border-error`;

export const SECTION_TITLE = 'text-xl font-bold';

const BUTTON =
  'inline-flex min-h-touch items-center justify-center rounded-control px-4 py-2 text-base font-semibold disabled:opacity-60';

export const PRIMARY_BUTTON = `${BUTTON} bg-accent text-accent-fg`;

export const SECONDARY_BUTTON = `${BUTTON} border border-border-strong bg-surface text-fg`;

export const DANGER_BUTTON = `${BUTTON} bg-error text-on-state disabled:cursor-not-allowed`;

/** A text link that is still a 44px touch target. */
export const TEXT_LINK =
  'inline-flex min-h-touch items-center self-start text-accent underline';
