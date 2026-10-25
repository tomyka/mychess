import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import type { RepertoireGraph } from '../repertoire/graph';
import { learnPlan, type LearnLine } from './learn-plan';
import {
  advanceLearn,
  currentLearnStep,
  playLearn,
  startLearnSession,
  type LearnEmit,
  type LearnSessionState,
} from './learn-session';

function graph(pgn: string): RepertoireGraph {
  const r = importPgn(pgn, 'white');
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}

// Two chapters sharing 1. e4 e5 2. Nf3 Nc6 3. Bc4.
const italian = graph(
  '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 *\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 *',
);
const now = new Date('2026-10-25T10:00:00Z');
const plan = learnPlan(
  [{ id: 'r', graph: italian, active: true }],
  new Set(),
  10,
);
function lineAt(i: number): LearnLine {
  const line = plan[i];
  if (line === undefined) throw new Error(`no line ${String(i)}`);
  return line;
}
const first = lineAt(0);
const second = lineAt(1);
const keyOf = (line: LearnLine, san: string): string => {
  const step = line.steps.find((s) => s.move.san === san);
  if (step === undefined) throw new Error(san);
  return step.key;
};
const stepOf = (s: LearnSessionState, san: string) =>
  s.states.get(keyOf(s.line, san))?.step;

/** Plays each step's right move (or advances an opponent step) through one round. */
function runRound(s: LearnSessionState): {
  state: LearnSessionState;
  emits: LearnEmit[];
} {
  const emits: LearnEmit[] = [];
  const round = s.round;
  let state = s;
  while (!state.done && state.round === round) {
    const step = currentLearnStep(state);
    if (step === undefined) throw new Error('no step');
    if (step.kind === 'opponent') {
      state = advanceLearn(state);
      continue;
    }
    const t = playLearn(state, step.move.san, now);
    if (t.emit !== null) emits.push(t.emit);
    state = t.state;
  }
  return { state, emits };
}
const blindStart = (line: LearnLine) => runRound(startLearnSession(line)).state;

describe('learnSession', () => {
  it('starts the arrows round at the first step with the arrow on', () => {
    const s = startLearnSession(first);
    expect(s).toMatchObject({
      round: 'arrows',
      index: 0,
      arrow: true,
      done: false,
    });
    expect(currentLearnStep(s)?.move.san).toBe('e4');
    expect(stepOf(s, 'e4')).toBe('shown');
  });
  it('holds learn states for the new keys only', () => {
    const s = startLearnSession(second);
    expect([...s.states.keys()]).toEqual([keyOf(second, 'd3')]);
  });
  it('the right arrow move asks the move blind next and goes on', () => {
    const t = playLearn(startLearnSession(first), 'e4', now);
    expect(t.correct).toBe(true);
    expect(t.emit).toBeNull();
    expect(t.state.index).toBe(1);
    expect(t.state.arrow).toBe(false);
    expect(stepOf(t.state, 'e4')).toBe('asked');
    expect(advanceLearn(t.state).arrow).toBe(true);
  });
  it('advances an opponent step, and nothing else', () => {
    const atReply = playLearn(startLearnSession(first), 'e4', now).state;
    const afterReply = advanceLearn(atReply);
    expect(afterReply.index).toBe(2);
    expect(currentLearnStep(afterReply)?.move.san).toBe('Nf3');
    expect(advanceLearn(afterReply)).toBe(afterReply);
  });
  it('a wrong arrow move changes nothing', () => {
    const s = startLearnSession(first);
    const t = playLearn(s, 'd4', now);
    expect(t.correct).toBe(false);
    expect(t.emit).toBeNull();
    expect(t.state).toBe(s);
  });
  it('play at an opponent step changes nothing', () => {
    const s = playLearn(startLearnSession(first), 'e4', now).state;
    const t = playLearn(s, 'e5', now);
    expect(t).toEqual({ state: s, emit: null, correct: false });
    expect(t.state).toBe(s);
  });
  it('turns to the blind round after the last arrow step', () => {
    const { state, emits } = runRound(startLearnSession(first));
    expect(state).toMatchObject({
      round: 'blind',
      index: 0,
      arrow: false,
      done: false,
    });
    expect(emits).toEqual([]);
    expect(
      first.steps
        .filter((x) => x.kind === 'new')
        .map((x) => state.states.get(x.key)?.step),
    ).toEqual(['asked', 'asked', 'asked', 'asked']);
  });
  it('a right blind move on a new step emits learned and goes on', () => {
    const t = playLearn(blindStart(first), 'e4', now);
    expect(t.correct).toBe(true);
    expect(t.emit).toEqual({ kind: 'learned', key: keyOf(first, 'e4') });
    expect(t.state.index).toBe(1);
    expect(stepOf(t.state, 'e4')).toBe('learned');
  });
  it('a wrong blind move shows the arrow, then asks the same step blind again', () => {
    const atNf3 = advanceLearn(playLearn(blindStart(first), 'e4', now).state);
    const wrong = playLearn(atNf3, 'd4', now);
    expect(wrong.correct).toBe(false);
    expect(wrong.emit).toBeNull();
    expect(wrong.state.arrow).toBe(true);
    expect(wrong.state.index).toBe(2);
    expect(stepOf(wrong.state, 'Nf3')).toBe('shown');

    const stillWrong = playLearn(wrong.state, 'd4', now);
    expect(stillWrong.correct).toBe(false);
    expect(stillWrong.state).toBe(wrong.state);

    const seen = playLearn(wrong.state, 'Nf3', now);
    expect(seen.correct).toBe(true);
    expect(seen.emit).toBeNull();
    expect(seen.state.arrow).toBe(false);
    expect(seen.state.index).toBe(2);
    expect(stepOf(seen.state, 'Nf3')).toBe('asked');

    const learned = playLearn(seen.state, 'Nf3', now);
    expect(learned.emit).toEqual({ kind: 'learned', key: keyOf(first, 'Nf3') });
    expect(learned.state.index).toBe(3);
  });
  it('ends when the blind round ends, each new key learned once', () => {
    const { state, emits } = runRound(blindStart(first));
    expect(state.done).toBe(true);
    expect(state.arrow).toBe(false);
    expect(currentLearnStep(state)).toBeUndefined();
    expect(emits.map((e) => e.key)).toEqual(
      first.steps.filter((x) => x.kind === 'new').map((x) => x.key),
    );
    expect([...state.states.values()].every((x) => x.step === 'learned')).toBe(
      true,
    );
  });
  it('play and advance change nothing once done', () => {
    const { state } = runRound(blindStart(first));
    expect(playLearn(state, 'e4', now)).toEqual({
      state,
      emit: null,
      correct: false,
    });
    expect(advanceLearn(state)).toBe(state);
  });
  it('a known step goes on in the arrows round without a learn state', () => {
    const t = playLearn(startLearnSession(second), 'e4', now);
    expect(t.correct).toBe(true);
    expect(t.state.index).toBe(1);
    expect(t.state.states).toEqual(startLearnSession(second).states);
  });
  it('a known step emits nothing blind; a wrong move shows its arrow only', () => {
    const blind = blindStart(second);
    const right = playLearn(blind, 'e4', now);
    expect(right).toMatchObject({ emit: null, correct: true });
    expect(right.state.index).toBe(1);

    const atNf3 = advanceLearn(right.state);
    const wrong = playLearn(atNf3, 'd4', now);
    expect(wrong).toMatchObject({ emit: null, correct: false });
    expect(wrong.state.arrow).toBe(true);
    expect(wrong.state.index).toBe(2);
    expect(wrong.state.states).toBe(atNf3.states);

    const fixed = playLearn(wrong.state, 'Nf3', now);
    expect(fixed).toMatchObject({ emit: null, correct: true });
    expect(fixed.state.arrow).toBe(false);
    expect(fixed.state.index).toBe(3);
  });
  it('starts a line that opens with a known step without an arrow (R-144)', () => {
    const s = startLearnSession(second);
    expect(currentLearnStep(s)?.kind).toBe('known');
    expect(s).toMatchObject({ round: 'arrows', index: 0, arrow: false });
  });
  it('in the arrows round shows an arrow on new steps only (R-144)', () => {
    const arrows: [string, boolean][] = [];
    let s = startLearnSession(second);
    while (s.round === 'arrows') {
      const step = currentLearnStep(s);
      if (step === undefined) throw new Error('no step');
      arrows.push([`${step.kind}:${step.move.san}`, s.arrow]);
      s =
        step.kind === 'opponent'
          ? advanceLearn(s)
          : playLearn(s, step.move.san, now).state;
    }
    expect(arrows).toEqual([
      ['known:e4', false],
      ['opponent:e5', false],
      ['known:Nf3', false],
      ['opponent:Nc6', false],
      ['known:Bc4', false],
      ['opponent:Nf6', false],
      ['new:d3', true],
    ]);
  });
  it('a wrong move on a known step in the arrows round shows its arrow, the right one goes on', () => {
    const s = startLearnSession(second);
    const wrong = playLearn(s, 'd4', now);
    expect(wrong).toMatchObject({ emit: null, correct: false });
    expect(wrong.state).toMatchObject({
      round: 'arrows',
      index: 0,
      arrow: true,
    });
    expect(wrong.state.states).toBe(s.states);

    const again = playLearn(wrong.state, 'd4', now);
    expect(again.correct).toBe(false);
    expect(again.state).toBe(wrong.state);

    const right = playLearn(wrong.state, 'e4', now);
    expect(right).toMatchObject({ emit: null, correct: true });
    expect(right.state).toMatchObject({ index: 1, arrow: false });
    expect(right.state.states).toEqual(s.states);
  });
  it('a wrong move on a new step in the arrows round changes nothing', () => {
    let s = startLearnSession(second);
    while (currentLearnStep(s)?.kind !== 'new') {
      const step = currentLearnStep(s);
      if (step === undefined) throw new Error('no step');
      s =
        step.kind === 'opponent'
          ? advanceLearn(s)
          : playLearn(s, step.move.san, now).state;
    }
    const t = playLearn(s, 'h3', now);
    expect(t).toEqual({ state: s, emit: null, correct: false });
  });
  it('an empty line starts done', () => {
    const empty: LearnLine = { ...first, steps: [] };
    const s = startLearnSession(empty);
    expect(s).toMatchObject({ done: true, arrow: false });
    expect(currentLearnStep(s)).toBeUndefined();
    expect(playLearn(s, 'e4', now)).toEqual({
      state: s,
      emit: null,
      correct: false,
    });
  });
  it('emits only the new move of a line with known steps', () => {
    const { emits } = runRound(blindStart(second));
    expect(emits).toEqual([{ kind: 'learned', key: keyOf(second, 'd3') }]);
  });
});
