import {
  positionAfterMove,
  positionKey,
  START_KEY,
  type BoardMove,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { answerFlash, drillFrame, type Asked, type Flash } from './drill-frame';

const AFTER_D4 = positionKey(
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1',
);

const A3: BoardMove = { orig: 'a2', dest: 'a3', san: 'a3', promotion: null };
const E4: BoardMove = { orig: 'e2', dest: 'e4', san: 'e4', promotion: null };

/** The start position asked, with its arrow and hint, a move taken. */
function asked(overrides: Partial<Asked> = {}): Asked {
  return {
    repertoireId: 'london',
    chapterId: 'c1',
    key: START_KEY,
    last: undefined,
    arrow: 'e2e4',
    hint: 'e2e4',
    playable: true,
    typeable: true,
    ...overrides,
  };
}

describe('the answer flash', () => {
  it('flashes a right move on its square, holding nothing', () => {
    expect(answerFlash(START_KEY, E4, true)).toEqual({
      square: 'e4',
      kind: 'correct',
    });
  });

  it('holds a wrong move’s position and move for its flash (#381)', () => {
    expect(answerFlash(START_KEY, A3, false)).toEqual({
      square: 'a3',
      kind: 'wrong',
      after: { key: positionAfterMove(START_KEY, A3), uci: 'a2a3' },
    });
    const promotion: BoardMove = { ...A3, promotion: 'q' };
    expect(answerFlash(START_KEY, promotion, false).after?.uci).toBe('a2a3q');
  });
});

describe('the drill frame', () => {
  it('shows what the drill asks, with its marks and the side asked', () => {
    const flash: Flash = { square: 'e4', kind: 'correct' };
    expect(drillFrame(asked(), { flash, revision: 2 })).toEqual({
      repertoireId: 'london',
      chapterId: 'c1',
      asked: START_KEY,
      key: START_KEY,
      last: undefined,
      arrow: 'e2e4',
      hint: 'e2e4',
      flash,
      revision: 2,
      playable: true,
      typeable: true,
      toMove: 'white',
    });
  });

  it('asks the side to move in the asked position', () => {
    const frame = drillFrame(asked({ key: AFTER_D4, last: 'd2d4' }), {
      flash: null,
      revision: 0,
    });
    expect(frame.toMove).toBe('black');
    expect(frame.last).toBe('d2d4');
  });

  it('keeps what the drill says of playing and typing when nothing is held', () => {
    const sliding = asked({ playable: false, typeable: true });
    const frame = drillFrame(sliding, { flash: null, revision: 0 });
    expect(frame.playable).toBe(false);
    expect(frame.typeable).toBe(true);
    const wrongUnheld: Flash = { square: 'a3', kind: 'wrong' };
    const flashed = drillFrame(asked(), { flash: wrongUnheld, revision: 1 });
    expect(flashed.key).toBe(START_KEY);
    expect(flashed.playable).toBe(true);
  });

  it('holds a wrong move in place of the asked position: no arrow, no hint, no move taken (#381, R-59)', () => {
    const flash = answerFlash(START_KEY, A3, false);
    const frame = drillFrame(asked(), { flash, revision: 1 });
    expect(frame.key).toBe(positionAfterMove(START_KEY, A3));
    expect(frame.last).toBe('a2a3');
    expect(frame.arrow).toBeUndefined();
    expect(frame.hint).toBeUndefined();
    expect(frame.playable).toBe(false);
    expect(frame.typeable).toBe(false);
    expect(frame.flash).toBe(flash);
    // The asked position and its side stay: the moves taken after are its.
    expect(frame.asked).toBe(START_KEY);
    expect(frame.toMove).toBe('white');
    expect(frame.repertoireId).toBe('london');
  });
});
