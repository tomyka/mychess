export type LearnStepName = 'shown' | 'asked' | 'learned';
export type LearnEvent = 'seen' | 'correct' | 'wrong';
export interface LearnState {
  readonly key: string;
  readonly step: LearnStepName;
}

/** Arrow shown, then a blind retest; one correct retest ends the pass (R-55). */
const NEXT: Readonly<
  Record<LearnStepName, Partial<Record<LearnEvent, LearnStepName>>>
> = {
  shown: { seen: 'asked' },
  asked: { correct: 'learned', wrong: 'shown' },
  learned: {},
};

export const startLearn = (key: string): LearnState => ({ key, step: 'shown' });

export function learnStep(state: LearnState, event: LearnEvent): LearnState {
  const step = NEXT[state.step][event];
  return step === undefined ? state : { key: state.key, step };
}
