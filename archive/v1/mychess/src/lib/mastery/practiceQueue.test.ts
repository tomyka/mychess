import { describe, it, expect } from 'vitest';
import { orderPracticeQueue, variationErrorRate, type MoveAttemptStat } from './practiceQueue';
import type { VariationStep } from './variations';

/** A step only needs moveId/isPlayerTurn for queue ordering; the rest is irrelevant here. */
function step(moveId: string, isPlayerTurn = true): VariationStep {
	return { moveId, san: 'e4', fromFen: 'f', toFen: 't', isPlayerTurn } as VariationStep;
}

function stat(moveId: string, attempts: number, wrong: number, lastAttemptAt: string | null = null): MoveAttemptStat {
	return { moveId, attempts, wrong, lastAttemptAt };
}

const statsBy = (stats: MoveAttemptStat[]) => new Map(stats.map((s) => [s.moveId, s]));

describe('variationErrorRate', () => {
	it('is null for a variation with no recorded attempts', () => {
		expect(variationErrorRate([step('m1'), step('m2')], statsBy([]))).toBeNull();
	});

	it('averages over attempts, not over moves — a much-failed move dominates a rarely-played one', () => {
		// m1: 9 wrong of 10. m2: 0 wrong of 1. Per-attempt = 9/11, per-move mean would be 0.45.
		const rate = variationErrorRate([step('m1'), step('m2')], statsBy([stat('m1', 10, 9), stat('m2', 1, 0)]));
		expect(rate).toBeCloseTo(9 / 11);
	});

	it('ignores opponent-turn plies — the player never answers those', () => {
		const path = [step('mine'), step('theirs', false)];
		const rate = variationErrorRate(path, statsBy([stat('mine', 2, 1), stat('theirs', 50, 50)]));
		expect(rate).toBe(0.5);
	});

	it('ignores attempts on moves outside this variation', () => {
		const rate = variationErrorRate([step('m1')], statsBy([stat('m1', 2, 0), stat('elsewhere', 10, 10)]));
		expect(rate).toBe(0);
	});
});

describe('orderPracticeQueue', () => {
	const v = (variationKey: string, moveIds: string[]) => ({
		variationKey,
		path: moveIds.map((m) => step(m))
	});

	it('puts the worse error rate first', () => {
		const order = orderPracticeQueue(
			[v('good', ['g']), v('bad', ['b'])],
			statsBy([stat('g', 10, 1), stat('b', 10, 8)])
		);
		expect(order).toEqual(['bad', 'good']);
	});

	// Tiering, and the reason for it: a line that has never been tested is a
	// bigger unknown than one repeatedly played correctly, but a line actively
	// being failed is a known problem and outranks both.
	it('ranks failing lines, then never-practised lines, then clean lines', () => {
		const order = orderPracticeQueue(
			[v('clean', ['c']), v('never', ['n']), v('failing', ['f'])],
			statsBy([stat('c', 5, 0, '2026-08-01T00:00:00.000Z'), stat('f', 5, 2, '2026-08-01T00:00:00.000Z')])
		);
		expect(order).toEqual(['failing', 'never', 'clean']);
	});

	it('breaks an error-rate tie by staleness, oldest first', () => {
		const order = orderPracticeQueue(
			[v('recent', ['r']), v('stale', ['s'])],
			statsBy([
				stat('r', 4, 2, '2026-08-19T00:00:00.000Z'),
				stat('s', 4, 2, '2026-06-01T00:00:00.000Z')
			])
		);
		expect(order).toEqual(['stale', 'recent']);
	});

	it('uses a variation\'s most recent attempt as its staleness, not its oldest', () => {
		const order = orderPracticeQueue(
			[
				{ variationKey: 'touched-recently', path: [step('a'), step('b')] },
				{ variationKey: 'untouched-since-june', path: [step('c')] }
			],
			statsBy([
				stat('a', 1, 0, '2026-01-01T00:00:00.000Z'),
				stat('b', 1, 0, '2026-08-19T00:00:00.000Z'),
				stat('c', 1, 0, '2026-06-01T00:00:00.000Z')
			])
		);
		expect(order).toEqual(['untouched-since-june', 'touched-recently']);
	});

	// Cold start: the whole pool is unpractised. Ordering must still be
	// deterministic and must not look arbitrary to the player.
	it('falls back to repertoire order when nothing has ever been practised', () => {
		const order = orderPracticeQueue([v('first', ['a']), v('second', ['b']), v('third', ['c'])], statsBy([]));
		expect(order).toEqual(['first', 'second', 'third']);
	});

	it('is stable: equal-priority variations keep their incoming order', () => {
		const order = orderPracticeQueue(
			[v('a', ['x']), v('b', ['y'])],
			statsBy([stat('x', 2, 1, '2026-08-01T00:00:00.000Z'), stat('y', 2, 1, '2026-08-01T00:00:00.000Z')])
		);
		expect(order).toEqual(['a', 'b']);
	});

	it('returns an empty queue for an empty pool rather than throwing', () => {
		expect(orderPracticeQueue([], statsBy([stat('x', 1, 1)]))).toEqual([]);
	});

	it('does not reorder the caller\'s array in place', () => {
		const pool = [v('good', ['g']), v('bad', ['b'])];
		orderPracticeQueue(pool, statsBy([stat('g', 4, 0), stat('b', 4, 4)]));
		expect(pool.map((p) => p.variationKey)).toEqual(['good', 'bad']);
	});
});
