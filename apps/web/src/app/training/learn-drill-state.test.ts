import {
  findLegalMove,
  learnLines,
  playLearn,
  positionAfterMove,
  START_KEY,
  type BoardMove,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf } from '../../../test/fixtures/repertoires';
import {
  afterPlay,
  frameOf,
  shownKey,
  startLearnDrill,
  type LearnDrillState,
} from './learn-drill-state';

const NOW = new Date('2026-10-25T08:00:00Z');

/** A drill over a short White line, 1. d4 d5 2. Bf4, with its arrows. */
function drill(): LearnDrillState {
  const lines = learnLines({
    repertoires: [
      { id: 'london', graph: graphOf('1. d4 d5 2. Bf4 *'), active: true },
    ],
    tracked: new Set(),
    learnedToday: 0,
    limits: { reviews: 20, newPerDay: 10 },
  });
  return startLearnDrill(lines, new Map(), { arrows: true });
}

/** The legal move `san` on the board of `s`. */
function moveOf(s: LearnDrillState, san: string): BoardMove {
  const move = findLegalMove(shownKey(s), san);
  if (move === null) throw new Error(`${san} is legal here`);
  return move;
}

/** Plays `san` on the board of `s`. */
function play(s: LearnDrillState, san: string): LearnDrillState {
  const { session } = s;
  if (session === null) throw new Error('the drill has a line');
  return afterPlay(s, moveOf(s, san), playLearn(session, san, NOW), NOW);
}

describe('the learn drill state', () => {
  it('holds a wrong move for the flash and takes no typed move meanwhile (#381)', () => {
    const start = drill();
    expect(shownKey(start)).toBe(START_KEY);
    const wrong = play(start, 'e4');
    expect(wrong.flash).toEqual({
      square: 'e4',
      kind: 'wrong',
      after: {
        key: positionAfterMove(START_KEY, moveOf(start, 'e4')),
        uci: 'e2e4',
      },
    });
    expect(frameOf(wrong).typeable).toBe(false);
    const unflashed = { ...wrong, flash: null };
    expect(frameOf(unflashed).typeable).toBe(true);
    expect(frameOf(unflashed).key).toBe(START_KEY);
    expect(frameOf(unflashed).arrow).toBe('d2d4');
  });

  it('takes no move from the board or the field during a wrong move’s hold (#384)', () => {
    const wrong = play(drill(), 'e4');
    const held = frameOf(wrong);
    expect(held.playable).toBe(false);
    expect(held.typeable).toBe(false);
    expect(held.key).not.toBe(START_KEY);
    expect(held.asked).toBe(START_KEY);
    expect(held.toMove).toBe('white');
    const unflashed = frameOf({ ...wrong, flash: null });
    expect(unflashed.playable).toBe(true);
    expect(unflashed.typeable).toBe(true);
  });

  it('flashes a right move without holding a position', () => {
    const right = play(drill(), 'd4');
    expect(right.flash).toEqual({ square: 'd4', kind: 'correct' });
  });
});
