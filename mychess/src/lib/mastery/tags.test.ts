// src/lib/mastery/tags.test.ts
import { describe, it, expect } from 'vitest';
import { levelTag } from './tags';

describe('levelTag', () => {
	it('totalLevels 1: the only level is Beginner', () => {
		expect(levelTag(1, 1)).toBe('Beginner');
	});

	it('totalLevels 2: Beginner then Advanced (no Regular/Expert)', () => {
		expect(levelTag(1, 2)).toBe('Beginner');
		expect(levelTag(2, 2)).toBe('Advanced');
	});

	it('totalLevels 3: Beginner, Advanced, Expert', () => {
		expect(levelTag(1, 3)).toBe('Beginner');
		expect(levelTag(2, 3)).toBe('Advanced');
		expect(levelTag(3, 3)).toBe('Expert');
	});

	it('totalLevels 4: Regular appears at level 2', () => {
		expect(levelTag(1, 4)).toBe('Beginner');
		expect(levelTag(2, 4)).toBe('Regular');
		expect(levelTag(3, 4)).toBe('Advanced');
		expect(levelTag(4, 4)).toBe('Expert');
	});

	it('totalLevels 5: Regular grows to two levels', () => {
		expect(levelTag(1, 5)).toBe('Beginner');
		expect(levelTag(2, 5)).toBe('Regular');
		expect(levelTag(3, 5)).toBe('Regular');
		expect(levelTag(4, 5)).toBe('Advanced');
		expect(levelTag(5, 5)).toBe('Expert');
	});

	it('totalLevels 6: Beginner grows to two levels', () => {
		expect(levelTag(1, 6)).toBe('Beginner');
		expect(levelTag(2, 6)).toBe('Beginner');
		expect(levelTag(3, 6)).toBe('Regular');
		expect(levelTag(4, 6)).toBe('Regular');
		expect(levelTag(5, 6)).toBe('Advanced');
		expect(levelTag(6, 6)).toBe('Expert');
	});

	it('totalLevels 7: Advanced grows to two levels', () => {
		expect(levelTag(1, 7)).toBe('Beginner');
		expect(levelTag(2, 7)).toBe('Beginner');
		expect(levelTag(3, 7)).toBe('Regular');
		expect(levelTag(4, 7)).toBe('Regular');
		expect(levelTag(5, 7)).toBe('Advanced');
		expect(levelTag(6, 7)).toBe('Advanced');
		expect(levelTag(7, 7)).toBe('Expert');
	});

	it('totalLevels 10: Expert absorbs every level beyond 6', () => {
		expect(levelTag(6, 10)).toBe('Advanced');
		expect(levelTag(7, 10)).toBe('Expert');
		expect(levelTag(8, 10)).toBe('Expert');
		expect(levelTag(9, 10)).toBe('Expert');
		expect(levelTag(10, 10)).toBe('Expert');
	});
});
