import { describe, it, expect } from 'vitest';
import {
	planReconciliation,
	projectImpact,
	type CarryForward,
	type SeedNew,
	type PlayerProgress,
	type TeachingRow,
	type ImpactLine,
	buildCarryForwardPlan
} from './repertoire-reconcile';
import type { VariationDiff } from './repertoire-diff';

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

describe('projectImpact', () => {
	const lines: ImpactLine[] = [
		{ kind: 'unchanged', existingKey: 'u' },
		{ kind: 'extended', existingKey: 'e' },
		{ kind: 'truncated', existingKey: 't' },
		{ kind: 'diverged', existingKey: 'd' },
		{ kind: 'new', existingKey: null },
		{ kind: 'removed', existingKey: 'r' }
	];

	it('counts each classification', () => {
		expect(projectImpact(lines, []).counts).toEqual({
			unchanged: 1,
			extended: 1,
			truncated: 1,
			diverged: 1,
			new: 1,
			removed: 1
		});
	});

	it('counts only students who lose a learned line', () => {
		const impact = projectImpact(lines, [
			{ playerId: 'p1', solved: ['e', 'd'] }, // both demoting kinds — loses 2
			{ playerId: 'p2', solved: ['u', 't'] }, // both keep learned — loses 0
			{ playerId: 'p3', solved: ['e'] } //        loses 1
		]);
		expect(impact.demotedLineCount).toBe(3);
		expect(impact.affectedPlayerCount).toBe(2);
	});

	it('does not count a truncated or unchanged line as a demotion', () => {
		const impact = projectImpact(lines, [{ playerId: 'p1', solved: ['u', 't'] }]);
		expect(impact.demotedLineCount).toBe(0);
		expect(impact.affectedPlayerCount).toBe(0);
	});

	it('counts a removed learned line separately from a demotion', () => {
		// The row survives so restoring the line restores it, but the line is no
		// longer drilled — a different fact from "dropped back to review".
		const impact = projectImpact(lines, [{ playerId: 'p1', solved: ['r'] }]);
		expect(impact.removedLearnedCount).toBe(1);
		expect(impact.demotedLineCount).toBe(0);
		expect(impact.affectedPlayerCount).toBe(0);
	});

	it('reports no impact when nobody learned an affected line', () => {
		const impact = projectImpact(lines, [{ playerId: 'p1', solved: ['u'] }]);
		expect(impact.demotedLineCount).toBe(0);
		expect(impact.removedLearnedCount).toBe(0);
		expect(impact.affectedPlayerCount).toBe(0);
	});

	it('reports zero for no students', () => {
		const impact = projectImpact(lines, []);
		expect(impact.demotedLineCount).toBe(0);
		expect(impact.affectedPlayerCount).toBe(0);
	});

	it('ignores a solved key that no longer appears in the upload at all', () => {
		const impact = projectImpact(lines, [{ playerId: 'p1', solved: ['ghost'] }]);
		expect(impact.demotedLineCount).toBe(0);
		expect(impact.affectedPlayerCount).toBe(0);
	});

	it('accepts classifyVariations output directly', () => {
		// Structural compatibility with VariationDiff is the point — the coach's
		// projection consumes the classifier's own output with no mapping step.
		// Hoisted to a variable (rather than passed inline) so TS's excess-property
		// check on object literals doesn't trip over VariationDiff's extra `sans`/
		// `previousSans`/`commonPlies` fields — structural assignability is what's under test.
		const diffs: VariationDiff[] = [
			{ kind: 'diverged', existingKey: 'd', sans: ['e4'], previousSans: ['d4'], commonPlies: 1 }
		];
		const impact = projectImpact(diffs, [{ playerId: 'p1', solved: ['d'] }]);
		expect(impact.demotedLineCount).toBe(1);
	});
});

describe('buildCarryForwardPlan', () => {
	function teaching(key: string, mastered: number, taught = mastered): TeachingRow {
		return { variationKey: key, taughtPlies: taught, masteredPlies: mastered, cleanPassCount: 0 };
	}

	it('reads a stale key that became longer as extended', () => {
		const { carries } = buildCarryForwardPlan(['a>b>c'], progress({ teaching: [teaching('a>b', 2)] }));
		expect(carries).toEqual([{ kind: 'extended', fromKey: 'a>b', toKey: 'a>b>c', commonPlies: 2 }]);
	});

	it('reads a stale key that became shorter as truncated', () => {
		const { carries } = buildCarryForwardPlan(['a>b'], progress({ teaching: [teaching('a>b>c', 3)] }));
		expect(carries).toEqual([{ kind: 'truncated', fromKey: 'a>b>c', toKey: 'a>b', commonPlies: 2 }]);
	});

	it('reads a mid-line change as diverged', () => {
		const { carries } = buildCarryForwardPlan(['a>b>y'], progress({ teaching: [teaching('a>b>x', 3)] }));
		expect(carries).toEqual([{ kind: 'diverged', fromKey: 'a>b>x', toKey: 'a>b>y', commonPlies: 2 }]);
	});

	it('reads a key sharing nothing as removed', () => {
		const { carries } = buildCarryForwardPlan(['a>b'], progress({ teaching: [teaching('p>q', 2)] }));
		expect(carries).toEqual([{ kind: 'removed', fromKey: 'p>q', toKey: null, commonPlies: 0 }]);
	});

	it('emits no carry for a key that is still live', () => {
		const { carries, seeds } = buildCarryForwardPlan(['a>b'], progress({ teaching: [teaching('a>b', 2)] }));
		expect(carries).toEqual([]);
		expect(seeds).toEqual([]);
	});

	it('collects stale keys from solved, exclusions and the active pointer too', () => {
		const { carries } = buildCarryForwardPlan(
			['a>b>c'],
			progress({ solved: ['a>b'], excluded: ['a>z'], activeVariationKey: 'a>w' })
		);
		expect(carries.map((c) => c.fromKey).sort()).toEqual(['a>b', 'a>w', 'a>z']);
	});

	it('does not emit the same stale key twice when several tables hold it', () => {
		const { carries } = buildCarryForwardPlan(
			['a>b>c'],
			progress({ teaching: [teaching('a>b', 2)], solved: ['a>b'], excluded: ['a>b'] })
		);
		expect(carries).toHaveLength(1);
	});

	it('emits both carries when two stale keys collapse onto one live key', () => {
		const { carries } = buildCarryForwardPlan(
			['a>b>new'],
			progress({ teaching: [teaching('a>b>x', 3), teaching('a>b>y', 3)] })
		);
		expect(carries).toHaveLength(2);
		expect(carries.every((c) => c.toKey === 'a>b>new')).toBe(true);
	});

	it('seeds a new sibling from a shared prefix', () => {
		const { seeds } = buildCarryForwardPlan(['a>b>c', 'a>b>d'], progress({ teaching: [teaching('a>b>c', 3)] }));
		expect(seeds).toEqual([{ toKey: 'a>b>d', inheritedPlies: 2 }]);
	});

	it('clamps inherited depth to what the student actually mastered', () => {
		// Shares 2 plies with a>b>c, but they only mastered 1 of it.
		const { seeds } = buildCarryForwardPlan(['a>b>c', 'a>b>d'], progress({ teaching: [teaching('a>b>c', 1, 3)] }));
		expect(seeds).toEqual([{ toKey: 'a>b>d', inheritedPlies: 1 }]);
	});

	it('takes the deepest inheritance across several known lines', () => {
		// Both known lines are still live, so neither produces a carry and the new
		// line is genuinely unclaimed — otherwise the carries would target it and
		// the seed would (correctly) be suppressed as a collision.
		const { seeds } = buildCarryForwardPlan(
			['a>z', 'a>b>c>d>e', 'a>b>c>d>NEW'],
			progress({ teaching: [teaching('a>z', 2), teaching('a>b>c>d>e', 4)] })
		);
		expect(seeds).toEqual([{ toKey: 'a>b>c>d>NEW', inheritedPlies: 4 }]);
	});

	it('does not seed a line inheriting nothing', () => {
		const { seeds } = buildCarryForwardPlan(['x>y'], progress({ teaching: [teaching('a>b', 2)] }));
		expect(seeds).toEqual([]);
	});

	it('does not seed a live key a carry already maps onto', () => {
		// a>b>x became a>b>y; the carry moves the row there, so no seed.
		const { carries, seeds } = buildCarryForwardPlan(['a>b>y'], progress({ teaching: [teaching('a>b>x', 3)] }));
		expect(carries).toHaveLength(1);
		expect(seeds).toEqual([]);
	});

	it('returns nothing for a student with no progress', () => {
		expect(buildCarryForwardPlan(['a>b', 'a>c'], progress())).toEqual({ carries: [], seeds: [] });
	});

	it('feeds planReconciliation directly', () => {
		// The two functions compose — this is the whole lazy-reconciliation path.
		const p = progress({ teaching: [teaching('a>b', 2)], solved: ['a>b'] });
		const { carries, seeds } = buildCarryForwardPlan(['a>b>c'], p);
		const plan = planReconciliation(carries, seeds, p);
		expect(plan.teachingUpdates).toEqual([
			{ fromKey: 'a>b', toKey: 'a>b>c', taughtPlies: 2, masteredPlies: 2, cleanPassCount: 0 }
		]);
		expect(plan.demotions).toEqual([{ variationKey: 'a>b>c', cause: 'coach_update' }]);
	});
});

describe('planReconciliation — target key already occupied', () => {
	const STALE = 'a>b>x';
	const LIVE = 'a>b>y';

	function divergedOnto(from: string, to: string): CarryForward {
		return { kind: 'diverged', fromKey: from, toKey: to, commonPlies: 2 };
	}

	it('does not rekey onto a key that already has a teaching row', () => {
		const plan = planReconciliation(
			[divergedOnto(STALE, LIVE)],
			[],
			progress({
				teaching: [
					{ variationKey: STALE, taughtPlies: 3, masteredPlies: 3, cleanPassCount: 0 },
					{ variationKey: LIVE, taughtPlies: 2, masteredPlies: 2, cleanPassCount: 1 }
				]
			})
		);
		expect(plan.teachingUpdates).toEqual([]);
	});

	it('does not move learned onto an occupied key, and does not demote it', () => {
		const plan = planReconciliation(
			[divergedOnto(STALE, LIVE)],
			[],
			progress({ solved: [STALE, LIVE], teaching: [{ variationKey: LIVE, taughtPlies: 2, masteredPlies: 2, cleanPassCount: 0 }] })
		);
		expect(plan.solvedMoves).toEqual([]);
		expect(plan.solvedDeletes).toEqual([]);
		expect(plan.demotions).toEqual([]);
	});

	it('treats an occupying exclusion row as occupied too', () => {
		const plan = planReconciliation(
			[divergedOnto(STALE, LIVE)],
			[],
			progress({ excluded: [STALE, LIVE] })
		);
		expect(plan.exclusionMoves).toEqual([]);
	});

	it('treats an occupying solved row as occupied too', () => {
		const plan = planReconciliation(
			[divergedOnto(STALE, LIVE)],
			[],
			progress({
				solved: [LIVE],
				teaching: [{ variationKey: STALE, taughtPlies: 3, masteredPlies: 3, cleanPassCount: 0 }]
			})
		);
		expect(plan.teachingUpdates).toEqual([]);
	});

	it('still clears the active pointer when the occupied carry was active', () => {
		const plan = planReconciliation(
			[divergedOnto(STALE, LIVE)],
			[],
			progress({
				activeVariationKey: STALE,
				teaching: [{ variationKey: LIVE, taughtPlies: 2, masteredPlies: 2, cleanPassCount: 0 }]
			})
		);
		expect(plan.clearActiveVariation).toBe(true);
	});

	it('still carries normally when the target is unoccupied', () => {
		// Regression guard: the new check must not suppress the ordinary case.
		const plan = planReconciliation(
			[divergedOnto(STALE, LIVE)],
			[],
			progress({ teaching: [{ variationKey: STALE, taughtPlies: 3, masteredPlies: 3, cleanPassCount: 0 }] })
		);
		expect(plan.teachingUpdates).toHaveLength(1);
		expect(plan.teachingUpdates[0].toKey).toBe(LIVE);
	});
});
