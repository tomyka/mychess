// Which of the hero card's four states Today shows (spec, "The hero card").
export type HeroState = 'due' | 'learn' | 'done' | 'empty';

export function heroState({
  due,
  toLearn,
  rows,
}: {
  readonly due: number;
  readonly toLearn: number;
  /** How many repertoires the player trains. */
  readonly rows: number;
}): HeroState {
  if (rows === 0) return 'empty';
  if (due > 0) return 'due';
  return toLearn > 0 ? 'learn' : 'done';
}
