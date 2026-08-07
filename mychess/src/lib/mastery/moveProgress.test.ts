import { describe, it, expect } from 'vitest';
import { correctMoveIdSet, repertoireProgress } from './moveProgress';
import type { Variation } from './variations';

function variation(playerMoveCount: number, prefix: string): Variation {
	const path: Variation['path'] = [];
	for (let i = 1; i <= playerMoveCount; i++) {
		path.push({ moveId: `${prefix}p${i}`, san: `P${i}`, fromFen: `f${i}a`, toFen: `f${i}b`, isPlayerTurn: true });
		path.push({ moveId: `${prefix}o${i}`, san: `O${i}`, fromFen: `f${i}b`, toFen: `f${i + 1}a`, isPlayerTurn: false });
	}
	return {
		leafMoveId: path[path.length - 1].moveId,
		variationKey: path.map((s) => s.moveId).join('>'),
		path,
		playerMoveCount
	};
}

describe('correctMoveIdSet', () => {
	it('builds a Set of only the move ids whose state is correct', () => {
		const rows = [
			{ move_id: 'm1', state: 'correct' },
			{ move_id: 'm2', state: 'new' },
			{ move_id: 'm3', state: 'correct' }
		];
		const set = correctMoveIdSet(rows);
		expect(set.has('m1')).toBe(true);
		expect(set.has('m2')).toBe(false);
		expect(set.has('m3')).toBe(true);
		expect(set.size).toBe(2);
	});

	it('returns an empty Set for no rows', () => {
		expect(correctMoveIdSet([]).size).toBe(0);
	});
});

describe('repertoireProgress', () => {
	it('computes level, satisfiedCount, and totalVariations from raw rows for a partially-progressed repertoire', () => {
		const a = variation(3, 'a-');
		const b = variation(6, 'b-');
		const rows = [
			{ move_id: 'a-p1', state: 'correct' },
			{ move_id: 'a-p2', state: 'correct' },
			{ move_id: 'a-p3', state: 'correct' },
			{ move_id: 'b-p1', state: 'correct' },
			{ move_id: 'b-p2', state: 'correct' },
			{ move_id: 'b-p3', state: 'correct' }
		];
		const progress = repertoireProgress([a, b], rows);
		expect(progress.totalVariations).toBe(2);
		expect(progress.totalLevels).toBe(2); // ceil(6/3) — driven by the longer variation `b`
		expect(progress.level).toBe(2); // both satisfied at level 1 (depth 3); a is done, b needs level 2's depth 6
		expect(progress.satisfiedCount).toBe(1); // only `a` (fully covered) is satisfied at the active level 2
		// Level 2's own task count: `a` already finished at level 1 and drops
		// out, leaving only `b` — not the repertoire-wide total of 2.
		expect(progress.levelTaskCount).toBe(1);
		expect(progress.levelSolvedCount).toBe(0); // b's moves 4-6 aren't marked correct yet
	});

	it('reports every variation as satisfied once the repertoire is mastered', () => {
		const a = variation(2, 'x-');
		const rows = [
			{ move_id: 'x-p1', state: 'correct' },
			{ move_id: 'x-p2', state: 'correct' }
		];
		const progress = repertoireProgress([a], rows);
		expect(progress.level).toBe('mastered');
		expect(progress.satisfiedCount).toBe(1);
		expect(progress.totalVariations).toBe(1);
		expect(progress.totalLevels).toBe(1); // ceil(2/3)
		expect(progress.levelTaskCount).toBe(1);
		expect(progress.levelSolvedCount).toBe(1);
	});

	it('handles a repertoire with no variations yet', () => {
		const progress = repertoireProgress([], []);
		expect(progress.level).toBe('mastered');
		expect(progress.satisfiedCount).toBe(0);
		expect(progress.totalVariations).toBe(0);
		expect(progress.totalLevels).toBe(0);
		expect(progress.levelTaskCount).toBe(0);
		expect(progress.levelSolvedCount).toBe(0);
	});

	it("scopes levelTaskCount to the active level, unlike the repertoire-wide totalVariations", () => {
		// A French-opening-style repertoire: a couple of short lines finished
		// early, a couple of longer ones still going — this is the "30/93"
		// scenario the level-scoped stat replaces.
		const short1 = variation(2, 's1-');
		const short2 = variation(3, 's2-');
		const long1 = variation(9, 'l1-');
		const long2 = variation(9, 'l2-');
		const rows = [
			...short1.path.filter((s) => s.isPlayerTurn),
			...short2.path.filter((s) => s.isPlayerTurn),
			...long1.path.filter((s) => s.isPlayerTurn).slice(0, 3),
			...long2.path.filter((s) => s.isPlayerTurn).slice(0, 3)
		].map((s) => ({ move_id: s.moveId, state: 'correct' }));
		const progress = repertoireProgress([short1, short2, long1, long2], rows);
		expect(progress.totalVariations).toBe(4); // the old, confusing repertoire-wide count
		expect(progress.level).toBe(2); // level 1 (depth 3) fully done for all four
		// At level 2: both short variations are already finished (depth ≤ 3)
		// and drop out; only the two long ones still have content here.
		expect(progress.levelTaskCount).toBe(2);
		expect(progress.levelSolvedCount).toBe(0); // neither has reached depth 6 yet
	});
});
