// The settings page's shared class names: one card per section on a wide
// screen; on a phone the sections are separated by a rule instead. The
// buttons are in ../buttons.ts.

const SECTION_BASE =
  'flex flex-col gap-4 border-t pt-6 sm:rounded-card sm:border sm:bg-surface sm:p-6 sm:shadow-card';

export const SECTION = `${SECTION_BASE} border-border`;

/** The delete section: the same card, edged in the error colour (R-82). */
export const DANGER_SECTION = `${SECTION_BASE} border-error`;

export const SECTION_TITLE = 'text-xl font-bold';

/** A text link that is still a 44px touch target. */
export const TEXT_LINK =
  'inline-flex min-h-touch items-center self-start text-accent underline';
