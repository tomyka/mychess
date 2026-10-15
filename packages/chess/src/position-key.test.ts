import { validateFen } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { positionKey } from './position-key';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const START_KEY = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

describe('positionKey', () => {
  it('keeps the first four FEN fields', () => {
    expect(positionKey(START)).toBe(START_KEY);
  });

  it('ignores the move counters', () => {
    expect(
      positionKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 12 40'),
    ).toBe(START_KEY);
  });

  it('keeps the en passant square', () => {
    expect(
      positionKey(
        'rnbqkbnr/pppp1ppp/8/8/3Pp3/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 2',
      ),
    ).toBe('rnbqkbnr/pppp1ppp/8/8/3Pp3/8/PPP1PPPP/RNBQKBNR b KQkq d3');
  });

  it('drops an en passant square no pawn can capture on', () => {
    expect(
      positionKey(
        'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      ),
    ).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -');
  });

  it('keeps a capturable en passant square for the side to move', () => {
    expect(
      positionKey(
        'rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3',
      ),
    ).toBe('rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6');
  });

  it('tolerates surrounding and repeated whitespace', () => {
    expect(
      positionKey(
        '  rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR  w KQkq -  0 1 ',
      ),
    ).toBe(START_KEY);
  });

  it('refuses a string that is not a FEN, saying why', () => {
    const reason = validateFen('not a fen').error ?? '';
    expect(reason).not.toBe('');
    expect(() => positionKey('not a fen')).toThrow(
      `Not a valid FEN: ${reason}`,
    );
  });
});
