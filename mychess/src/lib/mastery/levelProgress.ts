// mychess/src/lib/mastery/levelProgress.ts
import type { Variation } from './variations';
import { levelCap, levelTaskVariations, taskKey, type Level } from './levels';

export type QueueEntry = { key: string; status: 'pending' | 'cleared' };
export type LevelProgressRow = { level: number; prevLevelMistakes: number; queue: QueueEntry[] };
export type AttemptResult = { taskKey: string; hadMistake: boolean; prevLevelMistakeCount: number };

export type RepertoireProgress = {
	level: Level | 'mastered';
	totalVariations: number;
	totalLevels: number;
	levelTaskCount: number;
	levelSolvedCount: number;
};

const DEMOTION_THRESHOLD = 3;

/** A freshly shuffled, all-pending queue for every task at `level`. */
export function buildQueue(
	variations: Variation[],
	level: Level,
	random: () => number = Math.random
): QueueEntry[] {
	const keys = levelTaskVariations(variations, level).map((v) => taskKey(v, level));
	for (let i = keys.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[keys[i], keys[j]] = [keys[j], keys[i]];
	}
	return keys.map((key) => ({ key, status: 'pending' as const }));
}

/**
 * Reconciles a stored queue against the level's freshly-enumerated tasks —
 * handles a repertoire edited after a run started. Tasks no longer present
 * are dropped; newly-appearing tasks are appended as pending. Existing
 * entries (and their `cleared`/`pending` status) keep their position.
 */
export function reconcileQueue(queue: QueueEntry[], variations: Variation[], level: Level): QueueEntry[] {
	const freshKeys = new Set(levelTaskVariations(variations, level).map((v) => taskKey(v, level)));
	const kept = queue.filter((entry) => freshKeys.has(entry.key));
	const keptKeys = new Set(kept.map((entry) => entry.key));
	const added = [...freshKeys]
		.filter((key) => !keptKeys.has(key))
		.map((key) => ({ key, status: 'pending' as const }));
	return [...kept, ...added];
}

function isFullyCleared(queue: QueueEntry[]): boolean {
	return queue.every((entry) => entry.status === 'cleared');
}

/**
 * Advances a row whose queue is fully cleared to the next level, or — past
 * the repertoire's level cap — leaves it as a mastered terminal state,
 * keeping the just-cleared queue so the UI can still show "M/M solved"
 * instead of resetting to an empty 0/0.
 */
function advanceIfCleared(
	row: LevelProgressRow,
	variations: Variation[],
	cap: number,
	random: () => number
): LevelProgressRow {
	if (!isFullyCleared(row.queue)) return row;
	const nextLevel = row.level + 1;
	if (nextLevel > cap) return { ...row, level: nextLevel, prevLevelMistakes: 0 };
	return { level: nextLevel, prevLevelMistakes: 0, queue: buildQueue(variations, nextLevel, random) };
}

/**
 * Reconciles `row`'s queue against the current repertoire content and, if
 * that leaves it fully cleared, advances the level. Run on every load,
 * before serving an attempt, to absorb a repertoire edited after a run
 * started.
 */
export function syncLevelProgress(
	row: LevelProgressRow,
	variations: Variation[],
	random: () => number = Math.random
): LevelProgressRow {
	const cap = levelCap(variations);
	if (row.level > cap) return row; // already mastered — nothing to reconcile
	const reconciled = { ...row, queue: reconcileQueue(row.queue, variations, row.level) };
	return advanceIfCleared(reconciled, variations, cap, random);
}

/**
 * Applies one completed attempt's outcome to a level's run: accumulates
 * previous-level-band mistakes (demoting a level at the 3-strikes threshold
 * and discarding the departing level's queue), or marks the attempted task
 * cleared — requeuing it to the back on a mistake instead — advancing to
 * the next level once every task is cleared. There's nothing to demote
 * below level 1: no `previous` band exists there, so its mistake count
 * never actually matters, even though it can keep growing.
 */
export function resolveAttempt(
	row: LevelProgressRow,
	result: AttemptResult,
	variations: Variation[],
	random: () => number = Math.random
): LevelProgressRow {
	const cap = levelCap(variations);
	if (row.level > cap) return row; // already mastered — a stale/replayed report is a no-op
	if (!row.queue.some((entry) => entry.key === result.taskKey)) return row; // stale/unrecognized task — no-op

	const prevLevelMistakes = row.prevLevelMistakes + result.prevLevelMistakeCount;

	if (prevLevelMistakes >= DEMOTION_THRESHOLD && row.level > 1) {
		const demotedLevel = row.level - 1;
		return { level: demotedLevel, prevLevelMistakes: 0, queue: buildQueue(variations, demotedLevel, random) };
	}

	const queue = row.queue.map((entry) =>
		entry.key === result.taskKey && !result.hadMistake ? { ...entry, status: 'cleared' as const } : entry
	);
	const reordered = result.hadMistake
		? [...queue.filter((e) => e.key !== result.taskKey), queue.find((e) => e.key === result.taskKey)!]
		: queue;

	return advanceIfCleared({ level: row.level, prevLevelMistakes, queue: reordered }, variations, cap, random);
}

/**
 * Combines a repertoire's enumerated variations with its `level_progress`
 * row (or `null` if the player hasn't started it yet) into the summary both
 * `/practice` (the picker) and `/practice/[repertoire_id]` (the detail
 * screen) need. Read-only — never reconciles or persists; that's
 * `syncLevelProgress`'s job.
 */
export function repertoireProgress(variations: Variation[], row: LevelProgressRow | null): RepertoireProgress {
	const totalLevels = levelCap(variations);
	if (variations.length === 0) {
		return { level: 'mastered', totalVariations: 0, totalLevels: 0, levelTaskCount: 0, levelSolvedCount: 0 };
	}
	if (!row) {
		return {
			level: 1,
			totalVariations: variations.length,
			totalLevels,
			levelTaskCount: levelTaskVariations(variations, 1).length,
			levelSolvedCount: 0
		};
	}
	return {
		level: row.level > totalLevels ? 'mastered' : row.level,
		totalVariations: variations.length,
		totalLevels,
		levelTaskCount: row.queue.length,
		levelSolvedCount: row.queue.filter((e) => e.status === 'cleared').length
	};
}
