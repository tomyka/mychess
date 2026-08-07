// mychess/src/lib/mastery/levelProgress.test.ts
import { describe, it, expect } from 'vitest';
import {
	buildQueue,
	reconcileQueue,
	resolveAttempt,
	resolvePreviousLevelMistake,
	syncLevelProgress,
	repertoireProgress,
	type LevelProgressRow
} from './levelProgress';
import { taskKey } from './levels';
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

describe('buildQueue', () => {
	it('creates one pending entry per task at the level', () => {
		const a = variation(2, 'a-');
		const b = variation(6, 'b-');
		const queue = buildQueue([a, b], 1, () => 0);
		expect(queue).toHaveLength(2);
		expect(queue.every((e) => e.status === 'pending')).toBe(true);
	});

	it('shuffles using the injected random source', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const c = variation(2, 'c-');
		// random() always 0 -> Fisher-Yates walks the array end-to-start,
		// always swapping with index 0, ending on [b, c, a].
		const queue = buildQueue([a, b, c], 1, () => 0);
		expect(queue.map((e) => e.key)).toEqual([taskKey(b, 1), taskKey(c, 1), taskKey(a, 1)]);
	});
});

describe('reconcileQueue', () => {
	it('drops a queue entry whose task no longer exists', () => {
		const a = variation(2, 'a-');
		const queue = [
			{ key: taskKey(a, 1), status: 'pending' as const },
			{ key: 'stale-key', status: 'pending' as const }
		];
		expect(reconcileQueue(queue, [a], 1)).toEqual([{ key: taskKey(a, 1), status: 'pending' }]);
	});

	it('appends a newly-appearing task as pending, keeping existing order', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const queue = [{ key: taskKey(a, 1), status: 'cleared' as const }];
		expect(reconcileQueue(queue, [a, b], 1)).toEqual([
			{ key: taskKey(a, 1), status: 'cleared' },
			{ key: taskKey(b, 1), status: 'pending' }
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
				{ key: taskKey(a, 1), status: 'pending' },
				{ key: taskKey(b, 1), status: 'pending' }
			]
		};
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: false }, [a, b]);
		expect(next.queue).toEqual([
			{ key: taskKey(a, 1), status: 'cleared' },
			{ key: taskKey(b, 1), status: 'pending' }
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
				{ key: taskKey(a, 1), status: 'pending' },
				{ key: taskKey(b, 1), status: 'pending' }
			]
		};
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: true }, [a, b]);
		expect(next.queue).toEqual([
			{ key: taskKey(b, 1), status: 'pending' },
			{ key: taskKey(a, 1), status: 'pending' }
		]);
	});

	it('advances to the next level, with a fresh queue, once every task clears', () => {
		const a = variation(10, 'a-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: false }, [a], () => 0);
		expect(next.level).toBe(2);
		expect(next.prevLevelMistakes).toBe(0);
		expect(next.queue).toEqual([{ key: taskKey(a, 2), status: 'pending' }]);
	});

	it('becomes mastered past the level cap, keeping the cleared queue', () => {
		const a = variation(2, 'a-'); // 1-level repertoire (cap = 1)
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: false }, [a]);
		expect(next.level).toBe(2); // cap(1) + 1 — sentinel for "mastered"
		expect(next.queue).toEqual([{ key: taskKey(a, 1), status: 'cleared' }]);
	});

	it('preserves an unrelated nonzero prevLevelMistakes untouched', () => {
		const a = variation(2, 'a-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 2, queue: [{ key: taskKey(a, 1), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: true }, [a]);
		expect(next.prevLevelMistakes).toBe(2); // resolveAttempt never touches this counter
	});

	it('is a no-op when the row is already mastered (a replayed/duplicate report)', () => {
		const a = variation(2, 'a-'); // cap = 1
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1), status: 'cleared' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: false }, [a]);
		expect(next).toEqual(row);
	});

	it('is a no-op when the reported taskKey is not in the queue (stale/unrecognized report)', () => {
		const a = variation(10, 'a-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: 'not-a-real-key', hadMistake: false }, [a]);
		expect(next).toEqual(row);
	});

	it('resets prevLevelMistakes to 0 when mastering, even with a nonzero count at the moment of mastery', () => {
		const a = variation(2, 'a-'); // cap = 1
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 2, queue: [{ key: taskKey(a, 1), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: false }, [a]);
		expect(next.level).toBe(2);
		expect(next.prevLevelMistakes).toBe(0);
	});
});

describe('resolvePreviousLevelMistake', () => {
	it('increments the counter without demoting, below the threshold', () => {
		const a = variation(10, 'a-');
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 2), status: 'pending' }] };
		const { row: next, demoted } = resolvePreviousLevelMistake(row, [a]);
		expect(demoted).toBe(false);
		expect(next.prevLevelMistakes).toBe(1);
		expect(next.level).toBe(2);
		expect(next.queue).toEqual(row.queue); // untouched — this isn't resolveAttempt's job
	});

	it('demotes on the 3rd mistake even though no attempt ever completed', () => {
		const a = variation(10, 'a-');
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 2, queue: [{ key: taskKey(a, 2), status: 'pending' }] };
		const { row: next, demoted } = resolvePreviousLevelMistake(row, [a], () => 0);
		expect(demoted).toBe(true);
		expect(next.level).toBe(1);
		expect(next.prevLevelMistakes).toBe(0);
		expect(next.queue).toEqual([{ key: taskKey(a, 1), status: 'pending' }]); // fresh queue, departing level's discarded
	});

	it('never demotes below level 1, and stops accumulating there', () => {
		const a = variation(10, 'a-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 5, queue: [{ key: taskKey(a, 1), status: 'pending' }] };
		const { row: next, demoted } = resolvePreviousLevelMistake(row, [a]);
		expect(demoted).toBe(false);
		expect(next).toEqual(row);
	});

	it('is a no-op once mastered', () => {
		const a = variation(2, 'a-'); // cap = 1
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1), status: 'cleared' }] };
		const { row: next, demoted } = resolvePreviousLevelMistake(row, [a]);
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
				{ key: taskKey(a, 1), status: 'cleared' },
				{ key: 'removed-task', status: 'pending' }
			]
		};
		const next = syncLevelProgress(row, [a], () => 0);
		expect(next.level).toBe(2); // cap(1)+1, mastered
	});

	it('leaves an already-mastered row untouched', () => {
		const a = variation(2, 'a-');
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1), status: 'cleared' }] };
		expect(syncLevelProgress(row, [a])).toEqual(row);
	});
});

describe('repertoireProgress', () => {
	it('is "mastered" vacuously for a repertoire with no variations', () => {
		expect(repertoireProgress([], null)).toEqual({
			level: 'mastered',
			totalVariations: 0,
			totalLevels: 0,
			levelTaskCount: 0,
			levelSolvedCount: 0
		});
	});

	it('defaults to a fresh level 1 when no row exists yet', () => {
		const a = variation(6, 'a-');
		const progress = repertoireProgress([a], null);
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
				{ key: taskKey(a, 2), status: 'cleared' },
				{ key: taskKey(b, 2), status: 'pending' }
			]
		};
		const progress = repertoireProgress([a, b], row);
		expect(progress.level).toBe(2);
		expect(progress.levelTaskCount).toBe(2);
		expect(progress.levelSolvedCount).toBe(1);
	});

	it('reports "mastered" once the row level exceeds the cap', () => {
		const a = variation(2, 'a-');
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1), status: 'cleared' }] };
		const progress = repertoireProgress([a], row);
		expect(progress.level).toBe('mastered');
		expect(progress.levelTaskCount).toBe(1);
		expect(progress.levelSolvedCount).toBe(1);
	});
});
