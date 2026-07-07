// mychess/src/lib/mastery/levels.test.ts
import { describe, it, expect } from 'vitest';
import { levelDepth, targetDepth, isSatisfied, currentLevel, activeLevel } from './levels';

describe('levelDepth', () => {
	it('returns the fixed depth for each level', () => {
		expect(levelDepth(1)).toBe(4);
		expect(levelDepth(2)).toBe(6);
		expect(levelDepth(3)).toBe(8);
		expect(levelDepth(4)).toBe(10);
		expect(levelDepth(5)).toBe(Infinity);
	});
});

describe('targetDepth', () => {
	it('is the level depth when the variation is longer', () => {
		expect(targetDepth({ playerMoveCount: 12 }, 2)).toBe(6);
	});

	it('is the variations own length when shorter than the level depth', () => {
		expect(targetDepth({ playerMoveCount: 3 }, 2)).toBe(3);
	});

	it('is the full variation length at level 5 regardless of length', () => {
		expect(targetDepth({ playerMoveCount: 47 }, 5)).toBe(47);
	});
});

describe('isSatisfied', () => {
	it('is satisfied once deepestReached meets the target depth', () => {
		expect(isSatisfied({ playerMoveCount: 10 }, 2, 6)).toBe(true);
		expect(isSatisfied({ playerMoveCount: 10 }, 2, 5)).toBe(false);
	});

	it('a naturally short variation is satisfied at every level once solved once', () => {
		expect(isSatisfied({ playerMoveCount: 3 }, 1, 3)).toBe(true);
		expect(isSatisfied({ playerMoveCount: 3 }, 5, 3)).toBe(true);
	});
});

describe('currentLevel', () => {
	it('is 0 when nothing is satisfied at level 1', () => {
		expect(currentLevel([{ playerMoveCount: 10, deepestReached: 0 }])).toBe(0);
	});

	it('is the highest level where every variation is satisfied', () => {
		const variations = [
			{ playerMoveCount: 10, deepestReached: 8 }, // satisfied through level 3 (depth 8), not level 4 (needs 10)
			{ playerMoveCount: 10, deepestReached: 10 }
		];
		expect(currentLevel(variations)).toBe(3);
	});

	it('a naturally short variation never blocks progress past its own length', () => {
		const variations = [
			{ playerMoveCount: 3, deepestReached: 3 }, // maxed out already, satisfied at every level
			{ playerMoveCount: 10, deepestReached: 10 }
		];
		expect(currentLevel(variations)).toBe(5);
	});

	it('is 5 for an empty variation list (nothing to master)', () => {
		expect(currentLevel([])).toBe(5);
	});
});

describe('activeLevel', () => {
	it('is currentLevel + 1', () => {
		expect(activeLevel([{ playerMoveCount: 10, deepestReached: 0 }])).toBe(1);
		expect(activeLevel([{ playerMoveCount: 10, deepestReached: 4 }])).toBe(2);
	});

	it('is "mastered" once every variation satisfies level 5', () => {
		expect(activeLevel([{ playerMoveCount: 10, deepestReached: 10 }])).toBe('mastered');
	});

	it('is "mastered" for an empty variation list', () => {
		expect(activeLevel([])).toBe('mastered');
	});
});
