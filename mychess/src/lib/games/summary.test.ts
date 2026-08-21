import { describe, it, expect } from 'vitest';
import { summarizeAnalysis } from './summary';

describe('summarizeAnalysis', () => {
	it('returns null for an unanalyzed game', () => {
		expect(summarizeAnalysis(null)).toBeNull();
	});

	it('counts each classification, ignoring unflagged moves', () => {
		const analysis = [
			{ classification: 'blunder' as const },
			{ classification: 'blunder' as const },
			{ classification: 'mistake' as const },
			{ classification: 'inaccuracy' as const },
			{ classification: null }
		];
		expect(summarizeAnalysis(analysis)).toEqual({ blunders: 2, mistakes: 1, inaccuracies: 1 });
	});
});
