import { describe, it, expect } from 'vitest';
import { cpLoss, classifyMove } from './classify';

describe('cpLoss', () => {
	it('is zero when the position after the move matches the mover\'s own pre-move evaluation', () => {
		// Before: +30 for the mover (their own turn). After the move, relative
		// to the opponent (now to move): -30 — an exact match once negated
		// back to the mover's own perspective.
		expect(cpLoss({ cp: 30 }, { cp: -30 })).toBe(0);
	});

	it('is positive when the position got worse for the mover than the engine expected', () => {
		// Before: +100 for the mover. After, relative to the opponent: +50 —
		// i.e. -50 for the mover, a 150cp swing against them.
		expect(cpLoss({ cp: 100 }, { cp: 50 })).toBe(150);
	});

	it('never goes negative when the move outperforms the engine\'s expectation', () => {
		expect(cpLoss({ cp: 0 }, { cp: -50 })).toBe(0);
	});

	it('treats squandering a forced mate as a huge loss', () => {
		// Before: mate in 3 for the mover. After: a flat 0cp — the mate is gone.
		const loss = cpLoss({ mate: 3 }, { cp: 0 });
		expect(loss).toBeGreaterThan(200);
	});

	it('treats walking into a forced mate against you as a huge loss', () => {
		// After the move, the engine reports mate in 3 for whoever is now to
		// move (the opponent) — i.e. the mover just allowed a forced mate.
		const loss = cpLoss({ cp: 0 }, { mate: 3 });
		expect(loss).toBeGreaterThan(200);
	});
});

describe('classifyMove', () => {
	it('flags nothing under 25cp loss', () => {
		expect(classifyMove(0)).toBeNull();
		expect(classifyMove(24)).toBeNull();
	});

	it('flags 25-99cp loss as an inaccuracy', () => {
		expect(classifyMove(25)).toBe('inaccuracy');
		expect(classifyMove(99)).toBe('inaccuracy');
	});

	it('flags 100-199cp loss as a mistake', () => {
		expect(classifyMove(100)).toBe('mistake');
		expect(classifyMove(199)).toBe('mistake');
	});

	it('flags 200cp+ loss as a blunder', () => {
		expect(classifyMove(200)).toBe('blunder');
		expect(classifyMove(10000)).toBe('blunder');
	});
});
