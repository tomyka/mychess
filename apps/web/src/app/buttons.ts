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

/**
 * An action that belongs to the content (Today's rows, the drill's Hint and
 * Type): tinted with the accent, not outlined. Unavailable, it fades to
 * half and says so to the pointer (aria-disabled).
 */
export const TONAL_BUTTON = `${BUTTON} bg-accent-subtle text-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50`;

/** A way out that must not compete with the page's work (End session, Done beside a next step). */
export const QUIET_ACTION = `${BUTTON} text-fg-muted hover:text-fg`;

// The buttons on an accent card (Today's hero, training's Nothing due): the
// main one inverted (surface on accent), the second outlined in the card's
// text colour. The focus ring takes the card's text colour, as the page's
// accent ring would vanish on the accent card.
const HERO_BUTTON = `${BUTTON} focus-visible:outline-accent-fg`;
export const HERO_PRIMARY_BUTTON = `${HERO_BUTTON} bg-surface text-accent`;
export const HERO_SECONDARY_BUTTON = `${HERO_BUTTON} border border-accent-fg text-accent-fg`;

/**
 * The way back to the parent page (the shell's inner pages, the training
 * screen): an icon-only 44px square, pulled left so the icon lines up with
 * the page's edge rather than the button's.
 */
export const BACK_BUTTON =
  '-ml-2 flex size-touch shrink-0 items-center justify-center rounded-control text-accent hover:bg-sunken';

/**
 * A rare action kept out of the way, such as asking to unlink: underlined
 * muted text, still a 44px touch target, so it never outweighs the row's
 * main link (#329).
 */
export const QUIET_BUTTON =
  'inline-flex min-h-touch items-center text-sm text-fg-muted underline';
