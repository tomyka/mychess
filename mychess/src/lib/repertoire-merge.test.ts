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
	it('groups chapters sharing the same player, color, and base name, created moments apart', () => {
		const candidates = [
			candidate({ id: 'r1', name: 'My Study — Line A', createdAt: '2026-01-01T00:00:00Z' }),
			candidate({ id: 'r2', name: 'My Study — Line B', createdAt: '2026-01-01T00:00:05Z' })
		];
		const merges = planRepertoireMerges(candidates);
		expect(merges).toEqual([{ canonicalId: 'r1', duplicateIds: ['r2'] }]);
	});

	it('picks the earliest-created repertoire as canonical regardless of input order', () => {
		const candidates = [
			candidate({ id: 'r2', name: 'My Study — Line B', createdAt: '2026-01-01T00:00:05Z' }),
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
			candidate({ id: 'r1', playerId: 'player-1', name: 'My Study — Line A', createdAt: '2026-01-01T00:00:00Z' }),
			candidate({ id: 'r2', playerId: 'player-2', name: 'My Study — Line B', createdAt: '2026-01-01T00:00:05Z' })
		];
		expect(planRepertoireMerges(candidates)).toEqual([]);
	});

	it('does not merge across different colors', () => {
		const candidates = [
			candidate({ id: 'r1', color: 'white', name: 'My Study — Line A', createdAt: '2026-01-01T00:00:00Z' }),
			candidate({ id: 'r2', color: 'black', name: 'My Study — Line B', createdAt: '2026-01-01T00:00:05Z' })
		];
		expect(planRepertoireMerges(candidates)).toEqual([]);
	});

	it('does not merge repertoires with unrelated names', () => {
		const candidates = [
			candidate({ id: 'r1', name: 'Sicilian Defense', createdAt: '2026-01-01T00:00:00Z' }),
			candidate({ id: 'r2', name: 'Ruy Lopez', createdAt: '2026-01-01T00:00:05Z' })
		];
		expect(planRepertoireMerges(candidates)).toEqual([]);
	});

	it('groups three or more chapters from the same import into one merge group', () => {
		const candidates = [
			candidate({ id: 'r1', name: 'Study — A', createdAt: '2026-01-01T00:00:00Z' }),
			candidate({ id: 'r2', name: 'Study — B', createdAt: '2026-01-01T00:00:05Z' }),
			candidate({ id: 'r3', name: 'Study — C', createdAt: '2026-01-01T00:00:10Z' })
		];
		const merges = planRepertoireMerges(candidates);
		expect(merges).toEqual([{ canonicalId: 'r1', duplicateIds: ['r2', 'r3'] }]);
	});

	it('does not merge same-base-name repertoires created far apart in time', () => {
		// Both share the base name "Najdorf" (baseName splits on the first
		// " — "), but a real multi-chapter import's chapters are always
		// written back-to-back, seconds apart — a repertoire sharing that
		// name prefix from an unrelated import months later should NOT be
		// folded in just because the text happens to match.
		const candidates = [
			candidate({ id: 'r1', name: 'Najdorf — Line A', createdAt: '2026-01-01T00:00:00Z' }),
			candidate({ id: 'r2', name: 'Najdorf — Sicilian', createdAt: '2026-06-01T00:00:00Z' })
		];
		expect(planRepertoireMerges(candidates)).toEqual([]);
	});

	it('keeps two same-named import batches created far apart as separate merge groups', () => {
		const candidates = [
			candidate({ id: 'r1', name: 'Study — A', createdAt: '2026-01-01T00:00:00Z' }),
			candidate({ id: 'r2', name: 'Study — B', createdAt: '2026-01-01T00:00:05Z' }),
			candidate({ id: 'r3', name: 'Study — A', createdAt: '2026-06-01T00:00:00Z' }),
			candidate({ id: 'r4', name: 'Study — B', createdAt: '2026-06-01T00:00:05Z' })
		];
		const merges = planRepertoireMerges(candidates);
		expect(merges).toEqual([
			{ canonicalId: 'r1', duplicateIds: ['r2'] },
			{ canonicalId: 'r3', duplicateIds: ['r4'] }
		]);
	});
});
