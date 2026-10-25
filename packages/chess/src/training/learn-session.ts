/**
 * The learn session (R-144, R-55): one LearnLine played twice from its start,
 * the line's learn pass. In the `arrows` round each new move shows its arrow;
 * in the `blind` round it is asked without one. A new move runs its learn
 * pass (`learnStep`) and is emitted once learned, so the caller records it. A
 * known move is played for context, never graded and shown without an arrow;
 * a wrong move on it shows its arrow until the right one is played. The
 * browser drives it; it holds no clock of its own.
 */
import type { LearnLine, LearnPlanStep } from './learn-plan';
import { learnStep, startLearn, type LearnState } from './learn';

/** The two rounds of a line's learn pass: with arrows, then blind. */
export type LearnRound = 'arrows' | 'blind';

export interface LearnSessionState {
  readonly line: LearnLine;
  readonly round: LearnRound;
  /** The step to play next. */
  readonly index: number;
  /** Show the expected move's arrow. */
  readonly arrow: boolean;
  /** The learn state of each new key of the line. */
  readonly states: ReadonlyMap<string, LearnState>;
  readonly done: boolean;
}

export interface LearnEmit {
  readonly kind: 'learned';
  readonly key: string;
}

export interface LearnTransition {
  readonly state: LearnSessionState;
  readonly emit: LearnEmit | null;
  /** Whether the move played was the expected one. */
  readonly correct: boolean;
}

export const currentLearnStep = (
  s: LearnSessionState,
): LearnPlanStep | undefined => s.line.steps[s.index];

/** R-144: up front, only a new step in the arrows round shows its arrow. */
const arrowAt = (line: LearnLine, round: LearnRound, index: number): boolean =>
  round === 'arrows' && line.steps[index]?.kind === 'new';

export function startLearnSession(line: LearnLine): LearnSessionState {
  const states = new Map<string, LearnState>();
  for (const step of line.steps) {
    if (step.kind === 'new') states.set(step.key, startLearn(step.key));
  }
  return {
    line,
    round: 'arrows',
    index: 0,
    arrow: arrowAt(line, 'arrows', 0),
    states,
    done: line.steps.length === 0,
  };
}

/** The next step; past the last, the blind round or the end. */
function moveOn(s: LearnSessionState): LearnSessionState {
  const index = s.index + 1;
  if (index < s.line.steps.length)
    return { ...s, index, arrow: arrowAt(s.line, s.round, index) };
  if (s.round === 'arrows')
    return { ...s, round: 'blind', index: 0, arrow: false };
  return { ...s, index, arrow: false, done: true };
}

const withState = (
  s: LearnSessionState,
  state: LearnState,
): ReadonlyMap<string, LearnState> => new Map(s.states).set(state.key, state);

/** A move that was not the expected one: no emit, `state` as given. */
const wrong = (state: LearnSessionState): LearnTransition => ({
  state,
  emit: null,
  correct: false,
});

const goOn = (
  s: LearnSessionState,
  emit: LearnEmit | null = null,
): LearnTransition => ({ state: moveOn(s), emit, correct: true });

const showArrow = (s: LearnSessionState): LearnSessionState =>
  s.arrow ? s : { ...s, arrow: true };

/** An opponent step, once the UI has animated it. */
export function advanceLearn(s: LearnSessionState): LearnSessionState {
  return !s.done && currentLearnStep(s)?.kind === 'opponent' ? moveOn(s) : s;
}

const learnStateOf = (s: LearnSessionState, key: string): LearnState =>
  s.states.get(key) ?? startLearn(key);

/** A known move, in either round: no grade; a wrong move shows its arrow. */
const playKnown = (s: LearnSessionState, right: boolean): LearnTransition =>
  right ? goOn(s) : wrong(showArrow(s));

/** Arrows round, new move: wrong changes nothing; right marks it seen. */
function arrowsNew(
  s: LearnSessionState,
  step: LearnPlanStep,
  right: boolean,
  now: Date,
): LearnTransition {
  if (!right) return wrong(s);
  const seen = learnStep(learnStateOf(s, step.key), 'seen', now);
  return goOn({ ...s, states: withState(s, seen) });
}

/**
 * Blind round, new move: while its arrow is shown, the right move asks it
 * blind again at the same step; asked blind, the right move learns it and a
 * wrong one shows the arrow again.
 */
function blindNew(
  s: LearnSessionState,
  step: LearnPlanStep,
  right: boolean,
  now: Date,
): LearnTransition {
  const before = learnStateOf(s, step.key);
  if (before.step === 'shown') {
    if (!right) return wrong(s);
    const asked = learnStep(before, 'seen', now);
    const state = { ...s, arrow: false, states: withState(s, asked) };
    return { state, emit: null, correct: true };
  }
  const after = learnStep(before, right ? 'correct' : 'wrong', now);
  const states = withState(s, after);
  if (!right) return wrong({ ...s, arrow: true, states });
  return goOn({ ...s, states }, { kind: 'learned', key: step.key });
}

/** The player's move at a player step; anywhere else it changes nothing. */
export function playLearn(
  s: LearnSessionState,
  san: string,
  now: Date,
): LearnTransition {
  const step = currentLearnStep(s);
  if (s.done || step === undefined || step.kind === 'opponent') return wrong(s);
  const right = san === step.move.san;
  if (step.kind === 'known') return playKnown(s, right);
  return s.round === 'arrows'
    ? arrowsNew(s, step, right, now)
    : blindNew(s, step, right, now);
}
