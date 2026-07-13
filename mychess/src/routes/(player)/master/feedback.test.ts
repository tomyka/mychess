import { describe, it, expect } from 'vitest';
import { offBookOutcome, outcomeForcesRetry, nextChain } from './feedback';

describe('offBookOutcome', () => {
	it('treats fine and inaccuracy as a checkmark', () => {
		expect(offBookOutcome('fine')).toBe('check');
		expect(offBookOutcome('inaccuracy')).toBe('check');
	});

	it('treats mistake and blunder as a cross', () => {
		expect(offBookOutcome('mistake')).toBe('cross');
		expect(offBookOutcome('blunder')).toBe('cross');
	});
});

describe('outcomeForcesRetry', () => {
	it('only a cross forces a retry', () => {
		expect(outcomeForcesRetry('cross')).toBe(true);
		expect(outcomeForcesRetry('check')).toBe(false);
		expect(outcomeForcesRetry('star')).toBe(false);
		expect(outcomeForcesRetry('unknown')).toBe(false);
	});
});

describe('nextChain', () => {
	it('extends the chain on a book move', () => {
		expect(nextChain(3, 'star')).toBe(4);
	});

	it('resets the chain on anything else', () => {
		expect(nextChain(5, 'check')).toBe(0);
		expect(nextChain(5, 'cross')).toBe(0);
		expect(nextChain(5, 'unknown')).toBe(0);
	});
});
