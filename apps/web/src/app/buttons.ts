// The button class names every page shares: a 44px touch target with the
// label centred, in one of three weights. They style a <button> or an <a>.
// A disabled button is mostly a pending one whose label says what is
// happening ("Adding…"), so FADING_BUTTON fades it only to 85%: its label
// keeps 4.5:1 in both themes (docs/design/README.md, contrast table). The
// primary button does not fade, as a faded accent still reads as enabled:
// disabled, it turns to muted text on the sunken surface. A secondary or
// tonal control that is unavailable rather than pending (Draw at a chapter
// root, a Hint already used) carries aria-disabled instead, which fades it
// to half: it has no pending label to keep readable, and at 85% it still
// read as enabled (#381 part 4). Its click is guarded in code, and it stays
// focusable, so its reason (aria-describedby) can be reached.

/** Every button's frame: the 44px target, the label centred, no size yet. */
const FRAME =
  'inline-flex min-h-touch items-center justify-center rounded-control py-2 font-semibold disabled:cursor-not-allowed';

const SHAPE = `${FRAME} px-4 text-base`;

/** Pending: faded to 85%, so its label stays readable. */
const FADE = 'disabled:opacity-85';

const FADING_BUTTON = `${SHAPE} ${FADE}`;

/**
 * Unavailable, not pending: half faded. A control that is unavailable
 * carries aria-disabled and not native disabled, so only this fade applies.
 */
const UNAVAILABLE = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/** The tonal colours and the unavailable fade, whatever the button's size. */
const TONAL_LOOK = `${UNAVAILABLE} bg-accent-subtle text-accent`;

/** The page's main action; disabled, muted on the sunken surface. */
export const PRIMARY_BUTTON = `${SHAPE} bg-accent text-accent-fg disabled:bg-sunken disabled:text-fg-muted`;

/** Any other action. */
export const SECONDARY_BUTTON = `${FADING_BUTTON} ${UNAVAILABLE} border border-border-strong bg-surface text-fg`;

/** An action that destroys data. */
export const DANGER_BUTTON = `${FADING_BUTTON} bg-error text-on-state`;

/**
 * The first step of an action that takes away (Revoke): outlined in the
 * error tone, so it reads as destructive without the solid fill the
 * confirm step keeps.
 */
export const DANGER_OUTLINE_BUTTON = `${FADING_BUTTON} ${UNAVAILABLE} border border-error bg-surface text-error`;

/**
 * A destructive action as a full-width row of a card (Settings' Delete
 * account…): error-tone text, tinted on hover, a 44px touch target.
 */
export const DANGER_ROW =
  'flex min-h-touch w-full items-center rounded-control px-3 text-start font-medium text-error hover:bg-error-subtle';

/**
 * An action that belongs to the content (Today's rows, the drill's Hint and
 * Type): tinted with the accent, not outlined. Unavailable, it fades to
 * half and says so to the pointer (aria-disabled).
 */
export const TONAL_BUTTON = `${FADING_BUTTON} ${TONAL_LOOK}`;

/**
 * The tonal button made compact for a row it shares with text (the
 * repertoire page's summary row: "16% learned [Review 51] [Learn 10
 * today]"): smaller padding and text, still a 44px touch target.
 */
export const COMPACT_TONAL = `${FRAME} px-3 text-sm ${FADE} ${TONAL_LOOK}`;

/** A way out that must not compete with the page's work (End session, Done beside a next step). */
export const QUIET_ACTION = `${FADING_BUTTON} text-fg-muted hover:text-fg`;

// The buttons on an accent card (Today's hero, training's Nothing due): the
// main one inverted (surface on accent), the second outlined in the card's
// text colour. The focus ring takes the card's text colour, as the page's
// accent ring would vanish on the accent card.
const HERO_BUTTON = `${FADING_BUTTON} focus-visible:outline-accent-fg`;
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
