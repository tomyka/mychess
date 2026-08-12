import { describe, it, expect } from 'vitest';
import { planRepertoireMerges, type MergeCandidate } from './repertoire-merge';

function candidate(overrides: Partial<MergeCandidate> & { id: string }): MergeCandidate {
	return {
		playerId: 'player-1',
		color: 'white',
		name: 'My Study',
		createdAt: '2026-01-01T00:00:00Z',
		...overrides
	};
}

describe('planRepertoireMerges', () => {
	it('groups chapters sharing the same player, color, and base name', () => {
		const candidates = [
			candidate({ id: 'r1', name: 'My Study — Line A', createdAt: '2026-01-01T00:00:00Z' }),
			candidate({ id: 'r2', name: 'My Study — Line B', createdAt: '2026-01-02T00:00:00Z' })
		];
		const merges = planRepertoireMerges(candidates);
		expect(merges).toEqual([{ canonicalId: 'r1', duplicateIds: ['r2'] }]);
	});

	it('picks the earliest-created repertoire as canonical regardless of input order', () => {
		const candidates = [
			candidate({ id: 'r2', name: 'My Study — Line B', createdAt: '2026-01-02T00:00:00Z' }),
			candidate({ id: 'r1', name: 'My Study — Line A', createdAt: '2026-01-01T00:00:00Z' })
		];
		const merges = planRepertoireMerges(candidates);
		expect(merges).toEqual([{ canonicalId: 'r1', duplicateIds: ['r2'] }]);
	});

	it('leaves a group of one alone (nothing to merge)', () => {
		const candidates = [candidate({ id: 'r1', name: 'Solo Repertoire' })];
		expect(planRepertoireMerges(candidates)).toEqual([]);
	});

	it('does not merge across different players', () => {
		const candidates = [
			candidate({ id: 'r1', playerId: 'player-1', name: 'My Study — Line A' }),
			candidate({ id: 'r2', playerId: 'player-2', name: 'My Study — Line B' })
		];
		expect(planRepertoireMerges(candidates)).toEqual([]);
	});

	it('does not merge across different colors', () => {
		const candidates = [
			candidate({ id: 'r1', color: 'white', name: 'My Study — Line A' }),
			candidate({ id: 'r2', color: 'black', name: 'My Study — Line B' })
		];
		expect(planRepertoireMerges(candidates)).toEqual([]);
	});

	it('does not merge repertoires with unrelated names', () => {
		const candidates = [
			candidate({ id: 'r1', name: 'Sicilian Defense' }),
			candidate({ id: 'r2', name: 'Ruy Lopez' })
		];
		expect(planRepertoireMerges(candidates)).toEqual([]);
	});

	it('groups three or more chapters from the same import into one merge group', () => {
		const candidates = [
			candidate({ id: 'r1', name: 'Study — A', createdAt: '2026-01-01T00:00:00Z' }),
			candidate({ id: 'r2', name: 'Study — B', createdAt: '2026-01-02T00:00:00Z' }),
			candidate({ id: 'r3', name: 'Study — C', createdAt: '2026-01-03T00:00:00Z' })
		];
		const merges = planRepertoireMerges(candidates);
		expect(merges).toEqual([{ canonicalId: 'r1', duplicateIds: ['r2', 'r3'] }]);
	});
});
