// The button class names every page shares: a 44px touch target with the
// label centred, in one of three weights. They style a <button> or an <a>.
// A disabled button is mostly a pending one whose label says what is
// happening ("Adding…"), so it fades only to 85%: its label keeps 4.5:1 in
// both themes (docs/design/README.md, contrast table).

const BUTTON =
  'inline-flex min-h-touch items-center justify-center rounded-control px-4 py-2 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-85';

/** The page's main action. */
export const PRIMARY_BUTTON = `${BUTTON} bg-accent text-accent-fg`;

/** Any other action. */
export const SECONDARY_BUTTON = `${BUTTON} border border-border-strong bg-surface text-fg`;

/** An action that destroys data. */
export const DANGER_BUTTON = `${BUTTON} bg-error text-on-state`;
