// mychess/src/lib/mastery/levelProgress.test.ts
import { describe, it, expect } from 'vitest';
import {
	buildQueue,
	reconcileQueue,
	resolveAttempt,
	resolvePreviousLevelMistake,
	syncLevelProgress,
	repertoireProgress,
	repertoireShape,
	repertoireProgressFromShape,
	effectiveLevelCap,
	reviewFreshness,
	pickMaintenanceLevels,
	type LevelProgressRow
} from './levelProgress';
import { taskKey } from './levels';
import type { Variation } from './variations';

// A generous ceiling for tests that aren't about the depth cap itself —
// keeps them exercising the repertoire's own natural level cap unclamped.
const UNCAPPED = 100;

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

describe('buildQueue', () => {
	it('creates one pending entry per task at the level', () => {
		const a = variation(2, 'a-');
		const b = variation(6, 'b-');
		const queue = buildQueue([a, b], 1, 3, () => 0);
		expect(queue).toHaveLength(2);
		expect(queue.every((e) => e.status === 'pending')).toBe(true);
	});

	it('shuffles using the injected random source', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const c = variation(2, 'c-');
		// random() always 0 -> Fisher-Yates walks the array end-to-start,
		// always swapping with index 0, ending on [b, c, a].
		const queue = buildQueue([a, b, c], 1, 3, () => 0);
		expect(queue.map((e) => e.key)).toEqual([taskKey(b, 1, 3), taskKey(c, 1, 3), taskKey(a, 1, 3)]);
	});
});

describe('reconcileQueue', () => {
	it('drops a queue entry whose task no longer exists', () => {
		const a = variation(2, 'a-');
		const queue = [
			{ key: taskKey(a, 1, 3), status: 'pending' as const },
			{ key: 'stale-key', status: 'pending' as const }
		];
		expect(reconcileQueue(queue, [a], 1, 3)).toEqual([{ key: taskKey(a, 1, 3), status: 'pending' }]);
	});

	it('appends a newly-appearing task as pending, keeping existing order', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const queue = [{ key: taskKey(a, 1, 3), status: 'cleared' as const }];
		expect(reconcileQueue(queue, [a, b], 1, 3)).toEqual([
			{ key: taskKey(a, 1, 3), status: 'cleared' },
			{ key: taskKey(b, 1, 3), status: 'pending' }
		]);
	});
});

describe('resolveAttempt', () => {
	it('marks a clean attempt cleared in place', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const row: LevelProgressRow = {
			level: 1,
			prevLevelMistakes: 0,
			queue: [
				{ key: taskKey(a, 1, 3), status: 'pending' },
				{ key: taskKey(b, 1, 3), status: 'pending' }
			]
		};
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1, 3), hadMistake: false }, [a, b], UNCAPPED, 3);
		expect(next.queue).toEqual([
			{ key: taskKey(a, 1, 3), status: 'cleared' },
			{ key: taskKey(b, 1, 3), status: 'pending' }
		]);
		expect(next.level).toBe(1);
	});

	it('requeues a dirty attempt to the back instead of clearing it', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const row: LevelProgressRow = {
			level: 1,
			prevLevelMistakes: 0,
			queue: [
				{ key: taskKey(a, 1, 3), status: 'pending' },
				{ key: taskKey(b, 1, 3), status: 'pending' }
			]
		};
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1, 3), hadMistake: true }, [a, b], UNCAPPED, 3);
		expect(next.queue).toEqual([
			{ key: taskKey(b, 1, 3), status: 'pending' },
			{ key: taskKey(a, 1, 3), status: 'pending' }
		]);
	});

	it('advances to the next level, with a fresh queue, once every task clears', () => {
		const a = variation(10, 'a-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1, 3), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1, 3), hadMistake: false }, [a], UNCAPPED, 3, () => 0);
		expect(next.level).toBe(2);
		expect(next.prevLevelMistakes).toBe(0);
		expect(next.queue).toEqual([{ key: taskKey(a, 2, 3), status: 'pending' }]);
	});

	it('becomes mastered past the level cap, keeping the cleared queue', () => {
		const a = variation(2, 'a-'); // 1-level repertoire (cap = 1)
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1, 3), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1, 3), hadMistake: false }, [a], UNCAPPED, 3);
		expect(next.level).toBe(2); // cap(1) + 1 — sentinel for "mastered"
		expect(next.queue).toEqual([{ key: taskKey(a, 1, 3), status: 'cleared' }]);
	});

	it('preserves an unrelated nonzero prevLevelMistakes untouched', () => {
		const a = variation(2, 'a-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 2, queue: [{ key: taskKey(a, 1, 3), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1, 3), hadMistake: true }, [a], UNCAPPED, 3);
		expect(next.prevLevelMistakes).toBe(2); // resolveAttempt never touches this counter
	});

	it('is a no-op when the row is already mastered (a replayed/duplicate report)', () => {
		const a = variation(2, 'a-'); // cap = 1
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1, 3), status: 'cleared' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1, 3), hadMistake: false }, [a], UNCAPPED, 3);
		expect(next).toEqual(row);
	});

	it('is a no-op when the reported taskKey is not in the queue (stale/unrecognized report)', () => {
		const a = variation(10, 'a-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1, 3), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: 'not-a-real-key', hadMistake: false }, [a], UNCAPPED, 3);
		expect(next).toEqual(row);
	});

	it('sends an abandoned pin to the back of the queue alongside crediting the branch actually walked', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const c = variation(2, 'c-');
		const row: LevelProgressRow = {
			level: 1,
			prevLevelMistakes: 0,
			queue: [
				{ key: taskKey(a, 1, 3), status: 'pending' },
				{ key: taskKey(b, 1, 3), status: 'pending' },
				{ key: taskKey(c, 1, 3), status: 'pending' }
			]
		};
		// Attempt was pinned to `a`, but a mid-attempt branch was actually
		// credited to `b` — `a` gets no outcome of its own from `b`'s clear.
		const next = resolveAttempt(
			row,
			{ taskKey: taskKey(b, 1, 3), hadMistake: false, abandonedTaskKey: taskKey(a, 1, 3) },
			[a, b, c],
			UNCAPPED,
			3
		);
		expect(next.queue).toEqual([
			{ key: taskKey(b, 1, 3), status: 'cleared' },
			{ key: taskKey(c, 1, 3), status: 'pending' },
			{ key: taskKey(a, 1, 3), status: 'pending' }
		]);
	});

	it('does not re-requeue an abandoned pin that a previous attempt already cleared', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const row: LevelProgressRow = {
			level: 1,
			prevLevelMistakes: 0,
			queue: [
				{ key: taskKey(a, 1, 3), status: 'cleared' },
				{ key: taskKey(b, 1, 3), status: 'pending' }
			]
		};
		const next = resolveAttempt(
			row,
			{ taskKey: taskKey(b, 1, 3), hadMistake: false, abandonedTaskKey: taskKey(a, 1, 3) },
			[a, b],
			UNCAPPED,
			3
		);
		expect(next.queue).toEqual([
			{ key: taskKey(a, 1, 3), status: 'cleared' },
			{ key: taskKey(b, 1, 3), status: 'cleared' }
		]);
	});

	it('ignores an abandoned pin equal to the credited task itself', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const row: LevelProgressRow = {
			level: 1,
			prevLevelMistakes: 0,
			queue: [
				{ key: taskKey(a, 1, 3), status: 'pending' },
				{ key: taskKey(b, 1, 3), status: 'pending' }
			]
		};
		const next = resolveAttempt(
			row,
			{ taskKey: taskKey(a, 1, 3), hadMistake: false, abandonedTaskKey: taskKey(a, 1, 3) },
			[a, b],
			UNCAPPED,
			3
		);
		expect(next.queue).toEqual([
			{ key: taskKey(a, 1, 3), status: 'cleared' },
			{ key: taskKey(b, 1, 3), status: 'pending' }
		]);
	});

	it('resets prevLevelMistakes to 0 when mastering, even with a nonzero count at the moment of mastery', () => {
		const a = variation(2, 'a-'); // cap = 1
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 2, queue: [{ key: taskKey(a, 1, 3), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1, 3), hadMistake: false }, [a], UNCAPPED, 3);
		expect(next.level).toBe(2);
		expect(next.prevLevelMistakes).toBe(0);
	});

	it('becomes mastered at the configured practice depth even though the repertoire naturally goes deeper', () => {
		const a = variation(10, 'a-'); // natural cap = ceil(10/3) = 4
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 2, 3), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 2, 3), hadMistake: false }, [a], 2, 3, () => 0);
		expect(next.level).toBe(3); // cap(2)+1 — mastered at the configured depth, not the natural depth of 4
	});
});

describe('resolvePreviousLevelMistake', () => {
	it('increments the counter without demoting, below the threshold', () => {
		const a = variation(10, 'a-');
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 2, 3), status: 'pending' }] };
		const { row: next, demoted } = resolvePreviousLevelMistake(row, [a], UNCAPPED, 3);
		expect(demoted).toBe(false);
		expect(next.prevLevelMistakes).toBe(1);
		expect(next.level).toBe(2);
		expect(next.queue).toEqual(row.queue); // untouched — this isn't resolveAttempt's job
	});

	it('demotes on the 3rd mistake even though no attempt ever completed', () => {
		const a = variation(10, 'a-');
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 2, queue: [{ key: taskKey(a, 2, 3), status: 'pending' }] };
		const { row: next, demoted } = resolvePreviousLevelMistake(row, [a], UNCAPPED, 3, () => 0);
		expect(demoted).toBe(true);
		expect(next.level).toBe(1);
		expect(next.prevLevelMistakes).toBe(0);
		expect(next.queue).toEqual([{ key: taskKey(a, 1, 3), status: 'pending' }]); // fresh queue, departing level's discarded
	});

	it('never demotes below level 1, and stops accumulating there', () => {
		const a = variation(10, 'a-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 5, queue: [{ key: taskKey(a, 1, 3), status: 'pending' }] };
		const { row: next, demoted } = resolvePreviousLevelMistake(row, [a], UNCAPPED, 3);
		expect(demoted).toBe(false);
		expect(next).toEqual(row);
	});

	it('is a no-op once mastered', () => {
		const a = variation(2, 'a-'); // cap = 1
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1, 3), status: 'cleared' }] };
		const { row: next, demoted } = resolvePreviousLevelMistake(row, [a], UNCAPPED, 3);
		expect(demoted).toBe(false);
		expect(next).toEqual(row);
	});

	it('is a no-op once mastered at the configured practice depth, even below the natural cap', () => {
		const a = variation(10, 'a-'); // natural cap = 4
		const row: LevelProgressRow = { level: 3, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 2, 3), status: 'cleared' }] };
		const { row: next, demoted } = resolvePreviousLevelMistake(row, [a], 2, 3); // mastered at depth 2 (row.level 3 > cap 2)
		expect(demoted).toBe(false);
		expect(next).toEqual(row);
	});
});

describe('syncLevelProgress', () => {
	it('reconciles a stale queue and advances immediately if that makes it fully cleared', () => {
		const a = variation(2, 'a-');
		const row: LevelProgressRow = {
			level: 1,
			prevLevelMistakes: 0,
			queue: [
				{ key: taskKey(a, 1, 3), status: 'cleared' },
				{ key: 'removed-task', status: 'pending' }
			]
		};
		const next = syncLevelProgress(row, [a], UNCAPPED, 3, () => 0);
		expect(next.level).toBe(2); // cap(1)+1, mastered
	});

	it('leaves an already-mastered row untouched', () => {
		const a = variation(2, 'a-');
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1, 3), status: 'cleared' }] };
		expect(syncLevelProgress(row, [a], UNCAPPED, 3)).toEqual(row);
	});

	it('treats a row already past the configured practice depth as mastered, even if the repertoire goes deeper', () => {
		const a = variation(10, 'a-'); // natural cap = 4
		const row: LevelProgressRow = { level: 3, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 2, 3), status: 'cleared' }] };
		expect(syncLevelProgress(row, [a], 2, 3)).toEqual(row); // maxLevel 2 < row.level 3 — already "mastered", untouched
	});
});

describe('effectiveLevelCap', () => {
	it('is the natural cap when the configured depth is more generous', () => {
		const a = variation(6, 'a-'); // natural cap = 2
		expect(effectiveLevelCap([a], 6, 3)).toBe(2);
	});

	it('is the configured depth when it is stricter than the natural cap', () => {
		const a = variation(30, 'a-'); // natural cap = 10
		expect(effectiveLevelCap([a], 6, 3)).toBe(6);
	});
});

describe('repertoireProgress', () => {
	it('is "mastered" vacuously for a repertoire with no variations', () => {
		expect(repertoireProgress([], null, UNCAPPED, 3)).toEqual({
			level: 'mastered',
			totalVariations: 0,
			totalLevels: 0,
			levelTaskCount: 0,
			levelSolvedCount: 0
		});
	});

	it('defaults to a fresh level 1 when no row exists yet', () => {
		const a = variation(6, 'a-');
		const progress = repertoireProgress([a], null, UNCAPPED, 3);
		expect(progress.level).toBe(1);
		expect(progress.totalLevels).toBe(2); // ceil(6/3)
		expect(progress.levelTaskCount).toBe(1);
		expect(progress.levelSolvedCount).toBe(0);
	});

	it('reports the row level/queue directly when one exists', () => {
		const a = variation(6, 'a-');
		const b = variation(6, 'b-');
		const row: LevelProgressRow = {
			level: 2,
			prevLevelMistakes: 1,
			queue: [
				{ key: taskKey(a, 2, 3), status: 'cleared' },
				{ key: taskKey(b, 2, 3), status: 'pending' }
			]
		};
		const progress = repertoireProgress([a, b], row, UNCAPPED, 3);
		expect(progress.level).toBe(2);
		expect(progress.levelTaskCount).toBe(2);
		expect(progress.levelSolvedCount).toBe(1);
	});

	it('reports "mastered" once the row level exceeds the cap', () => {
		const a = variation(2, 'a-');
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1, 3), status: 'cleared' }] };
		const progress = repertoireProgress([a], row, UNCAPPED, 3);
		expect(progress.level).toBe('mastered');
		expect(progress.levelTaskCount).toBe(1);
		expect(progress.levelSolvedCount).toBe(1);
	});

	it('reports totalLevels clamped to the configured practice depth, not the natural depth', () => {
		const a = variation(30, 'a-'); // natural cap = 10
		const progress = repertoireProgress([a], null, 6, 3);
		expect(progress.totalLevels).toBe(6);
	});

	it('does not let the configured depth raise totalLevels above the natural cap', () => {
		const a = variation(6, 'a-'); // natural cap = 2
		const progress = repertoireProgress([a], null, 6, 3);
		expect(progress.totalLevels).toBe(2);
	});
});

describe('repertoireShape', () => {
	it('is all zeros for an empty repertoire', () => {
		expect(repertoireShape([], 3)).toEqual({ totalVariations: 0, totalLevels: 0, level1TaskCount: 0 });
	});

	it('matches repertoireProgress\'s own computation for a non-empty repertoire', () => {
		const a = variation(6, 'a-');
		const b = variation(2, 'b-');
		expect(repertoireShape([a, b], 3)).toEqual({ totalVariations: 2, totalLevels: 2, level1TaskCount: 2 });
	});
});

describe('repertoireProgressFromShape', () => {
	it('produces the exact same result as repertoireProgress given that variation set\'s shape', () => {
		const a = variation(6, 'a-');
		const b = variation(6, 'b-');
		const row: LevelProgressRow = {
			level: 2,
			prevLevelMistakes: 1,
			queue: [
				{ key: taskKey(a, 2, 3), status: 'cleared' },
				{ key: taskKey(b, 2, 3), status: 'pending' }
			]
		};
		expect(repertoireProgressFromShape(repertoireShape([a, b], 3), row)).toEqual(
			repertoireProgress([a, b], row, UNCAPPED, 3)
		);
	});

	it('is "mastered" vacuously for a zero-variation shape, independent of any row', () => {
		const shape = { totalVariations: 0, totalLevels: 0, level1TaskCount: 0 };
		expect(repertoireProgressFromShape(shape, null)).toEqual({
			level: 'mastered',
			totalVariations: 0,
			totalLevels: 0,
			levelTaskCount: 0,
			levelSolvedCount: 0
		});
	});
});

describe('reviewFreshness', () => {
	const now = new Date('2026-08-15T00:00:00Z');

	it('treats never-reviewed as overdue, not fresh', () => {
		expect(reviewFreshness(null, now)).toBe('overdue');
	});

	it('is fresh just under the fresh threshold', () => {
		const lastReviewedAt = new Date('2026-08-02T00:00:00Z').toISOString(); // 13 days ago
		expect(reviewFreshness(lastReviewedAt, now)).toBe('fresh');
	});

	it('is due-soon at exactly the fresh threshold', () => {
		const lastReviewedAt = new Date('2026-08-01T00:00:00Z').toISOString(); // 14 days ago
		expect(reviewFreshness(lastReviewedAt, now)).toBe('due-soon');
	});

	it('is overdue past the due-soon threshold', () => {
		const lastReviewedAt = new Date('2026-07-01T00:00:00Z').toISOString(); // 45 days ago
		expect(reviewFreshness(lastReviewedAt, now)).toBe('overdue');
	});

	it('is fresh immediately after reviewing', () => {
		expect(reviewFreshness(now.toISOString(), now)).toBe('fresh');
	});
});

describe('pickMaintenanceLevels', () => {
	it('returns every level, in some order, when totalLevels is under the session size', () => {
		const picked = pickMaintenanceLevels(4, 6, () => 0);
		expect(picked.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
	});

	it('caps at sessionSize distinct levels when the repertoire has more', () => {
		const picked = pickMaintenanceLevels(20, 6, () => 0);
		expect(picked).toHaveLength(6);
		expect(new Set(picked).size).toBe(6); // no repeats
		for (const level of picked) {
			expect(level).toBeGreaterThanOrEqual(1);
			expect(level).toBeLessThanOrEqual(20);
		}
	});

	it('returns an empty array for a zero-level repertoire', () => {
		expect(pickMaintenanceLevels(0, 6)).toEqual([]);
	});

	it('shuffles using the injected random source', () => {
		// random() always 0 -> Fisher-Yates walks the array end-to-start,
		// always swapping with index 0, ending on [2, 3, 1].
		const picked = pickMaintenanceLevels(3, 3, () => 0);
		expect(picked).toEqual([2, 3, 1]);
	});
});
