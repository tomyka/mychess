// What a finished drill offers next (docs/design/training-screen.md, Done):
// the drill decides which steps apply (use-drill's rules), this puts them
// in their one order, the first the main button, Done always last.

/** A Done step; `finish` is the Done button, back to where the player came from. */
export type DoneStep = 'continue' | 'review' | 'learn' | 'finish';

/** The next steps a finished drill offers besides Done. */
export interface DoneOffer {
  /** A new session over the Reviews that came due during this one (R-62). */
  readonly continue: boolean;
  /** On to review the moves due (after a learn pass). */
  readonly review: boolean;
  /** On to new moves, while today's allowance is not used up (R-146). */
  readonly learn: boolean;
}

/** Nothing offered but Done. */
export const NOTHING_MORE: DoneOffer = {
  continue: false,
  review: false,
  learn: false,
};

const ORDER = ['continue', 'review', 'learn'] as const;

/**
 * The steps offered, in order: Continue, Start review, Learn new moves,
 * then Done. The first is the main one.
 */
export const doneSteps = (offer: DoneOffer): readonly DoneStep[] => [
  ...ORDER.filter((step) => offer[step]),
  'finish',
];
