import { describe, it, expect } from 'vitest';
import { planReconciliation, type CarryForward, type SeedNew, type PlayerProgress } from './repertoire-reconcile';

const OLD_KEY = 'm0>m1>m2>m3';
const NEW_KEY = 'm0>m1>m2>m3>m4>m5';

function progress(over: Partial<PlayerProgress> = {}): PlayerProgress {
	return { teaching: [], solved: [], excluded: [], activeVariationKey: null, ...over };
}

function carry(over: Partial<CarryForward> = {}): CarryForward {
	return { kind: 'extended', fromKey: OLD_KEY, toKey: NEW_KEY, commonPlies: 4, ...over };
}

const LEARNED_DEEP = [{ variationKey: OLD_KEY, taughtPlies: 4, masteredPlies: 4, cleanPassCount: 2 }];

describe('planReconciliation', () => {
	it('writes nothing for an unchanged line', () => {
		const plan = planReconciliation(
			[carry({ kind: 'unchanged', toKey: OLD_KEY, commonPlies: 4 })],
			[],
			progress({ teaching: LEARNED_DEEP, solved: [OLD_KEY] })
		);
		expect(plan.teachingUpdates).toEqual([]);
		expect(plan.demotions).toEqual([]);
		expect(plan.solvedMoves).toEqual([]);
		expect(plan.solvedDeletes).toEqual([]);
	});

	it('keeps depth but demotes learned for an extended line', () => {
		const plan = planReconciliation([carry()], [], progress({ teaching: LEARNED_DEEP, solved: [OLD_KEY] }));
		expect(plan.teachingUpdates).toEqual([
			{ fromKey: OLD_KEY, toKey: NEW_KEY, taughtPlies: 4, masteredPlies: 4, cleanPassCount: 0 }
		]);
		expect(plan.solvedDeletes).toEqual([OLD_KEY]);
		expect(plan.demotions).toEqual([{ variationKey: NEW_KEY, cause: 'coach_update' }]);
	});

	it('clamps depth down to the common prefix for a diverged line', () => {
		const plan = planReconciliation(
			[carry({ kind: 'diverged', commonPlies: 2 })],
			[],
			progress({ teaching: LEARNED_DEEP, solved: [OLD_KEY] })
		);
		expect(plan.teachingUpdates[0].taughtPlies).toBe(2);
		expect(plan.teachingUpdates[0].masteredPlies).toBe(2);
		expect(plan.demotions).toHaveLength(1);
	});

	it('leaves learned intact for a truncated line, clamping depth', () => {
		// The student already knew MORE than the line now asks for.
		const plan = planReconciliation(
			[carry({ kind: 'truncated', commonPlies: 2 })],
			[],
			progress({ teaching: LEARNED_DEEP, solved: [OLD_KEY] })
		);
		expect(plan.demotions).toEqual([]);
		expect(plan.solvedDeletes).toEqual([]);
		expect(plan.solvedMoves).toEqual([{ fromKey: OLD_KEY, toKey: NEW_KEY }]);
		expect(plan.teachingUpdates[0].taughtPlies).toBe(2);
		expect(plan.teachingUpdates[0].cleanPassCount).toBe(2);
	});

	it('seeds a new line from its inherited prefix', () => {
		const seeds: SeedNew[] = [{ toKey: NEW_KEY, inheritedPlies: 11 }];
		const plan = planReconciliation([], seeds, progress());
		expect(plan.teachingInserts).toEqual([{ variationKey: NEW_KEY, taughtPlies: 11, masteredPlies: 11 }]);
	});

	it('does not seed a new line that inherits nothing', () => {
		const plan = planReconciliation([], [{ toKey: NEW_KEY, inheritedPlies: 0 }], progress());
		expect(plan.teachingInserts).toEqual([]);
	});

	it('does not seed over a line that already has progress', () => {
		// Re-running reconciliation must not reset a student who has since
		// practised the new line past its inherited depth.
		const plan = planReconciliation(
			[],
			[{ toKey: NEW_KEY, inheritedPlies: 11 }],
			progress({ teaching: [{ variationKey: NEW_KEY, taughtPlies: 14, masteredPlies: 12, cleanPassCount: 1 }] })
		);
		expect(plan.teachingInserts).toEqual([]);
	});

	it('rewrites an exclusion onto the new key instead of dropping it', () => {
		// reverifyExclusions would DELETE this row for having a stale key. The
		// student said "skip this line"; a coach fixing a typo must not undo that.
		const plan = planReconciliation([carry()], [], progress({ excluded: [OLD_KEY] }));
		expect(plan.exclusionMoves).toEqual([{ fromKey: OLD_KEY, toKey: NEW_KEY }]);
	});

	it('clears the active variation when it points at a removed line', () => {
		const plan = planReconciliation(
			[carry({ kind: 'removed', toKey: null, commonPlies: 0 })],
			[],
			progress({ activeVariationKey: OLD_KEY })
		);
		expect(plan.clearActiveVariation).toBe(true);
	});

	it('leaves the active variation alone when a different line was removed', () => {
		const plan = planReconciliation(
			[carry({ kind: 'removed', toKey: null, commonPlies: 0 })],
			[],
			progress({ activeVariationKey: 'someone>else' })
		);
		expect(plan.clearActiveVariation).toBe(false);
	});

	it('keeps progress rows for a removed line so restoring it restores state', () => {
		const plan = planReconciliation(
			[carry({ kind: 'removed', toKey: null, commonPlies: 0 })],
			[],
			progress({ teaching: LEARNED_DEEP, solved: [OLD_KEY] })
		);
		expect(plan.teachingUpdates).toEqual([]);
		expect(plan.solvedDeletes).toEqual([]);
	});

	it('writes nothing at all for a student with no progress', () => {
		const plan = planReconciliation([carry()], [], progress());
		expect(plan.teachingUpdates).toEqual([]);
		expect(plan.solvedMoves).toEqual([]);
		expect(plan.solvedDeletes).toEqual([]);
		expect(plan.demotions).toEqual([]);
		expect(plan.exclusionMoves).toEqual([]);
		expect(plan.clearActiveVariation).toBe(false);
	});

	it('never raises a depth, only clamps it', () => {
		// commonPlies deeper than what the student reached must not promote them.
		const plan = planReconciliation(
			[carry({ commonPlies: 99 })],
			[],
			progress({ teaching: [{ variationKey: OLD_KEY, taughtPlies: 4, masteredPlies: 2, cleanPassCount: 0 }] })
		);
		expect(plan.teachingUpdates[0].taughtPlies).toBe(4);
		expect(plan.teachingUpdates[0].masteredPlies).toBe(2);
	});
});

describe('planReconciliation — lines collapsing onto one key', () => {
	const A = 'a0>a1>a2>a3';
	const B = 'b0>b1>b2>b3';
	const MERGED = 'm0>m1>m2>m3';

	function collapsing(kind: CarryForward['kind'], from: string, commonPlies: number): CarryForward {
		return { kind, fromKey: from, toKey: MERGED, commonPlies };
	}

	it('emits one teaching update, from the deepest collapsing line', () => {
		const plan = planReconciliation(
			[collapsing('diverged', A, 4), collapsing('diverged', B, 4)],
			[],
			progress({
				teaching: [
					{ variationKey: A, taughtPlies: 4, masteredPlies: 2, cleanPassCount: 0 },
					{ variationKey: B, taughtPlies: 4, masteredPlies: 4, cleanPassCount: 1 }
				]
			})
		);
		expect(plan.teachingUpdates).toHaveLength(1);
		expect(plan.teachingUpdates[0].fromKey).toBe(B);
		expect(plan.teachingUpdates[0].masteredPlies).toBe(4);
	});

	it('compares clamped depths, not raw row depths', () => {
		// A's raw mastered is deeper, but its carry clamps to 1 — so B wins.
		const plan = planReconciliation(
			[collapsing('diverged', A, 1), collapsing('diverged', B, 3)],
			[],
			progress({
				teaching: [
					{ variationKey: A, taughtPlies: 9, masteredPlies: 9, cleanPassCount: 0 },
					{ variationKey: B, taughtPlies: 3, masteredPlies: 3, cleanPassCount: 0 }
				]
			})
		);
		expect(plan.teachingUpdates).toHaveLength(1);
		expect(plan.teachingUpdates[0].fromKey).toBe(B);
		expect(plan.teachingUpdates[0].masteredPlies).toBe(3);
	});

	it('logs exactly one demotion when a collapsed line loses learned', () => {
		const plan = planReconciliation(
			[collapsing('diverged', A, 4), collapsing('diverged', B, 4)],
			[],
			progress({ solved: [A, B] })
		);
		expect(plan.demotions).toEqual([{ variationKey: MERGED, cause: 'coach_update' }]);
		expect(plan.solvedDeletes.sort()).toEqual([A, B].sort());
		expect(plan.solvedMoves).toEqual([]);
	});

	it('keeps learned when any collapsing line keeps it, deleting the redundant row', () => {
		// B was truncated onto the merged line, so the student demonstrably knows
		// it. A diverged, but that no longer matters — the line is known.
		const plan = planReconciliation(
			[collapsing('diverged', A, 4), collapsing('truncated', B, 4)],
			[],
			progress({ solved: [A, B] })
		);
		expect(plan.solvedMoves).toEqual([{ fromKey: B, toKey: MERGED }]);
		expect(plan.solvedDeletes).toEqual([A]);
		expect(plan.demotions).toEqual([]);
	});

	it('emits one exclusion move when both collapsing lines were excluded', () => {
		const plan = planReconciliation(
			[collapsing('diverged', A, 4), collapsing('diverged', B, 4)],
			[],
			progress({ excluded: [A, B] })
		);
		expect(plan.exclusionMoves).toEqual([{ fromKey: A, toKey: MERGED }]);
	});

	it('does not seed a key a teaching update is already moving a row onto', () => {
		const plan = planReconciliation(
			[collapsing('diverged', A, 4)],
			[{ toKey: MERGED, inheritedPlies: 3 }],
			progress({ teaching: [{ variationKey: A, taughtPlies: 4, masteredPlies: 4, cleanPassCount: 0 }] })
		);
		expect(plan.teachingUpdates).toHaveLength(1);
		expect(plan.teachingInserts).toEqual([]);
	});

	it('still seeds a key no update targets', () => {
		const OTHER = 'z0>z1';
		const plan = planReconciliation(
			[collapsing('diverged', A, 4)],
			[{ toKey: OTHER, inheritedPlies: 3 }],
			progress({ teaching: [{ variationKey: A, taughtPlies: 4, masteredPlies: 4, cleanPassCount: 0 }] })
		);
		expect(plan.teachingInserts).toEqual([{ variationKey: OTHER, taughtPlies: 3, masteredPlies: 3 }]);
	});

	it('never emits two writes to the same key', () => {
		// The invariant that matters: every emitted list must be unique on the
		// key it writes, or the unique constraint aborts reconciliation and it
		// retries on every page load forever.
		const plan = planReconciliation(
			[collapsing('diverged', A, 4), collapsing('truncated', B, 4), collapsing('extended', 'c0>c1', 2)],
			[{ toKey: MERGED, inheritedPlies: 2 }],
			progress({
				teaching: [
					{ variationKey: A, taughtPlies: 4, masteredPlies: 4, cleanPassCount: 0 },
					{ variationKey: B, taughtPlies: 4, masteredPlies: 3, cleanPassCount: 2 },
					{ variationKey: 'c0>c1', taughtPlies: 2, masteredPlies: 2, cleanPassCount: 0 }
				],
				solved: [A, B],
				excluded: [A, B]
			})
		);
		const updateTargets = plan.teachingUpdates.map((u) => u.toKey);
		expect(new Set(updateTargets).size).toBe(updateTargets.length);
		const solvedTargets = plan.solvedMoves.map((s) => s.toKey);
		expect(new Set(solvedTargets).size).toBe(solvedTargets.length);
		const exclusionTargets = plan.exclusionMoves.map((e) => e.toKey);
		expect(new Set(exclusionTargets).size).toBe(exclusionTargets.length);
		const demotionTargets = plan.demotions.map((d) => d.variationKey);
		expect(new Set(demotionTargets).size).toBe(demotionTargets.length);
		const insertTargets = plan.teachingInserts.map((i) => i.variationKey);
		expect(new Set([...insertTargets, ...updateTargets]).size).toBe(insertTargets.length + updateTargets.length);
	});
});
