// The button class names every page shares: a 44px touch target with the
// label centred, in one of three weights. They style a <button> or an <a>.

const BUTTON =
  'inline-flex min-h-touch items-center justify-center rounded-control px-4 py-2 text-base font-semibold disabled:opacity-60';

/** The page's main action. */
export const PRIMARY_BUTTON = `${BUTTON} bg-accent text-accent-fg`;

/** Any other action. */
export const SECONDARY_BUTTON = `${BUTTON} border border-border-strong bg-surface text-fg`;

/** An action that destroys data. */
export const DANGER_BUTTON = `${BUTTON} bg-error text-on-state disabled:cursor-not-allowed`;
