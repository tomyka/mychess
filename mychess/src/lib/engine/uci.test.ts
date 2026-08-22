import { describe, it, expect } from 'vitest';
import {
	parseInfoLine,
	sideToMoveFromFen,
	toWhiteRelative,
	formatEval,
	evalBarWhiteFraction
} from './uci';

describe('parseInfoLine', () => {
	it('parses a depth + cp score info line', () => {
		expect(
			parseInfoLine('info depth 12 seldepth 18 multipv 1 score cp 35 nodes 123456 nps 800000 time 150 pv e2e4 e7e5')
		).toEqual({ depth: 12, score: { cp: 35 } });
	});

	it('parses a negative cp score', () => {
		expect(parseInfoLine('info depth 10 score cp -120 pv d7d5')).toEqual({ depth: 10, score: { cp: -120 } });
	});

	it('parses a mate score', () => {
		expect(
			parseInfoLine('info depth 5 seldepth 5 multipv 1 score mate 3 nodes 500 nps 10000 time 10 pv d1h5 g7g6 h5f3')
		).toEqual({ depth: 5, score: { mate: 3 } });
	});

	it('parses a negative mate score', () => {
		expect(parseInfoLine('info depth 4 score mate -2 pv a1a2')).toEqual({ depth: 4, score: { mate: -2 } });
	});

	it('returns null for an info string line with no score', () => {
		expect(parseInfoLine('info string NNUE evaluation using nn-1111cefa1111.nnue enabled')).toBeNull();
	});

	it('returns null for a bestmove line', () => {
		expect(parseInfoLine('bestmove e2e4 ponder e7e5')).toBeNull();
	});

	it('returns null for an unrelated protocol line', () => {
		expect(parseInfoLine('readyok')).toBeNull();
	});
});

describe('sideToMoveFromFen', () => {
	it('reads White to move', () => {
		expect(sideToMoveFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe('w');
	});

	it('reads Black to move', () => {
		expect(sideToMoveFromFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2')).toBe('b');
	});
});

describe('toWhiteRelative', () => {
	it('leaves a White-to-move cp score unchanged', () => {
		expect(toWhiteRelative({ cp: 35 }, 'w')).toEqual({ cp: 35 });
	});

	it('negates a Black-to-move cp score', () => {
		expect(toWhiteRelative({ cp: 35 }, 'b')).toEqual({ cp: -35 });
	});

	it('negates a Black-to-move mate score', () => {
		expect(toWhiteRelative({ mate: 3 }, 'b')).toEqual({ mate: -3 });
	});

	it('leaves a White-to-move mate score unchanged', () => {
		expect(toWhiteRelative({ mate: -2 }, 'w')).toEqual({ mate: -2 });
	});
});

describe('formatEval', () => {
	it('formats a positive cp score with a leading +', () => {
		expect(formatEval({ cp: 35 })).toBe('+0.3'); // 0.35 is 0.34999… in binary float
	});

	it('formats a negative cp score with a leading -', () => {
		expect(formatEval({ cp: -120 })).toBe('-1.2');
	});

	it('formats a zero cp score with no sign', () => {
		expect(formatEval({ cp: 0 })).toBe('0.0');
	});

	it('formats a positive mate score as White mating', () => {
		expect(formatEval({ mate: 3 })).toBe('M3');
	});

	it('formats a negative mate score as Black mating', () => {
		expect(formatEval({ mate: -2 })).toBe('-M2');
	});
});

describe('evalBarWhiteFraction', () => {
	it('is 0.5 at an equal position', () => {
		expect(evalBarWhiteFraction({ cp: 0 })).toBe(0.5);
	});

	it('is 1 at or beyond +500cp', () => {
		expect(evalBarWhiteFraction({ cp: 500 })).toBe(1);
		expect(evalBarWhiteFraction({ cp: 900 })).toBe(1);
	});

	it('is 0 at or beyond -500cp', () => {
		expect(evalBarWhiteFraction({ cp: -500 })).toBe(0);
		expect(evalBarWhiteFraction({ cp: -900 })).toBe(0);
	});

	it('is 1 for any White-mating score', () => {
		expect(evalBarWhiteFraction({ mate: 4 })).toBe(1);
	});

	it('is 0 for any Black-mating score', () => {
		expect(evalBarWhiteFraction({ mate: -4 })).toBe(0);
	});
});
