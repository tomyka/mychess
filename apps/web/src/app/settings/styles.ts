// Shared section class names. SECTION is the card of the form pages
// (import, new repertoire, assign): one card per section on a wide screen,
// lifted by its shadow (R-219); on a phone the sections are separated by a
// rule instead. Settings' own cards are soft cards at every width
// (SETTINGS_CARD, #381 part 6). The buttons are in ../buttons.ts.

const SECTION_BASE =
  'flex flex-col gap-4 border-t pt-6 sm:rounded-card sm:border sm:bg-surface sm:p-6 sm:shadow-card';

/** The rule on a phone; on a wide screen the card-edge hairline (dark only). */
export const SECTION = `${SECTION_BASE} border-border sm:border-card-edge`;

/** A destructive section: the same card, edged in the error colour (R-82). */
export const DANGER_SECTION = `${SECTION_BASE} border-error`;

/** A Settings card: a soft card at every width, tighter on a phone. */
export const SETTINGS_CARD =
  'flex flex-col gap-4 rounded-card border border-card-edge bg-surface p-4 shadow-card sm:p-6';

/** Settings' column: 640px on a wide screen. */
export const SETTINGS_COLUMN =
  'mx-auto flex w-full max-w-[40rem] flex-col gap-6 px-gutter py-6 sm:px-gutter-wide sm:py-8';

/** A text field's width in Settings: up to 360px. */
export const SETTINGS_FIELD = 'max-w-[22.5rem]';

// One definition, in the neutral ../surfaces.ts; kept here for the form
// pages that take their section classes from this module.
export { SECTION_TITLE } from '../surfaces';

/** A text link that is still a 44px touch target. */
export const TEXT_LINK =
  'inline-flex min-h-touch items-center self-start text-accent underline';
