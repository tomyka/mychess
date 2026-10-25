/**
 * The learn session (R-144, R-55): one LearnLine played in two passes. The
 * `arrows` pass shows each player move's arrow; the `blind` pass asks them
 * without it. A new move runs its learn pass (`learnStep`) and is emitted
 * once learned, so the caller records it; a known move is played for context
 * and never graded. The browser drives it; it holds no clock of its own.
 */
import type { LearnLine, LearnPlanStep } from './learn-plan';
import { learnStep, startLearn, type LearnState } from './learn';

export type LearnPass = 'arrows' | 'blind';

export interface LearnSessionState {
  readonly line: LearnLine;
  readonly pass: LearnPass;
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

export function startLearnSession(line: LearnLine): LearnSessionState {
  const states = new Map<string, LearnState>();
  for (const step of line.steps) {
    if (step.kind === 'new') states.set(step.key, startLearn(step.key));
  }
  return { line, pass: 'arrows', index: 0, arrow: true, states, done: false };
}

/** The next step; past the last, the blind pass or the end. */
function moveOn(s: LearnSessionState): LearnSessionState {
  const index = s.index + 1;
  if (index < s.line.steps.length)
    return { ...s, index, arrow: s.pass === 'arrows' };
  if (s.pass === 'arrows')
    return { ...s, pass: 'blind', index: 0, arrow: false };
  return { ...s, index, arrow: false, done: true };
}

const withState = (
  s: LearnSessionState,
  state: LearnState,
): ReadonlyMap<string, LearnState> => new Map(s.states).set(state.key, state);

const unchanged = (s: LearnSessionState): LearnTransition => ({
  state: s,
  emit: null,
  correct: false,
});

const goOn = (
  s: LearnSessionState,
  emit: LearnEmit | null = null,
): LearnTransition => ({ state: moveOn(s), emit, correct: true });

/** An opponent step, once the UI has animated it. */
export function advanceLearn(s: LearnSessionState): LearnSessionState {
  return !s.done && currentLearnStep(s)?.kind === 'opponent' ? moveOn(s) : s;
}

const learnStateOf = (s: LearnSessionState, key: string): LearnState =>
  s.states.get(key) ?? startLearn(key);

/** Arrows pass: a wrong move snaps back; a right new move has been seen. */
function playArrows(
  s: LearnSessionState,
  step: LearnPlanStep,
  right: boolean,
  now: Date,
): LearnTransition {
  if (!right) return unchanged(s);
  if (step.kind !== 'new') return goOn(s);
  const seen = learnStep(learnStateOf(s, step.key), 'seen', now);
  return goOn({ ...s, states: withState(s, seen) });
}

/** Blind pass, known move: no grade; a wrong move shows its arrow. */
function blindKnown(s: LearnSessionState, right: boolean): LearnTransition {
  return right
    ? goOn(s)
    : { state: { ...s, arrow: true }, emit: null, correct: false };
}

/**
 * Blind pass, new move: while its arrow is shown, the right move asks it
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
    if (!right) return unchanged(s);
    const asked = learnStep(before, 'seen', now);
    const state = { ...s, arrow: false, states: withState(s, asked) };
    return { state, emit: null, correct: true };
  }
  const after = learnStep(before, right ? 'correct' : 'wrong', now);
  const states = withState(s, after);
  if (!right)
    return { state: { ...s, arrow: true, states }, emit: null, correct: false };
  return goOn({ ...s, states }, { kind: 'learned', key: step.key });
}

function playBlind(
  s: LearnSessionState,
  step: LearnPlanStep,
  right: boolean,
  now: Date,
): LearnTransition {
  return step.kind === 'new'
    ? blindNew(s, step, right, now)
    : blindKnown(s, right);
}

/** The player's move at a player step; anywhere else it changes nothing. */
export function playLearn(
  s: LearnSessionState,
  san: string,
  now: Date,
): LearnTransition {
  const step = currentLearnStep(s);
  if (s.done || step === undefined || step.kind === 'opponent')
    return unchanged(s);
  const right = san === step.move.san;
  return s.pass === 'arrows'
    ? playArrows(s, step, right, now)
    : playBlind(s, step, right, now);
}
