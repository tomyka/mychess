// mychess/src/lib/mastery/levelProgress.ts
import type { Variation } from './variations';
import { levelCap, levelTaskVariations, taskKey, type Level } from './levels';

export type QueueEntry = { key: string; status: 'pending' | 'cleared' };
export type LevelProgressRow = { level: number; prevLevelMistakes: number; queue: QueueEntry[] };
export type AttemptResult = { taskKey: string; hadMistake: boolean };
export type MistakeOutcome = { row: LevelProgressRow; demoted: boolean };

export type RepertoireProgress = {
	level: Level | 'mastered';
	totalVariations: number;
	totalLevels: number;
	levelTaskCount: number;
	levelSolvedCount: number;
};

/**
 * The part of a repertoire's progress that depends only on its move content
 * (never on a player's `level_progress` row) — and, since moves are only
 * ever written once at import and never edited afterward, never changes
 * again for a given repertoire either. Safe to compute once and cache
 * indefinitely (see `total_variations`/`total_levels`/`level1_task_count`
 * on `repertoires`, written by `writeMoves` at import time).
 */
export type RepertoireShape = {
	totalVariations: number;
	totalLevels: number;
	level1TaskCount: number;
};

export function repertoireShape(variations: Variation[]): RepertoireShape {
	return {
		totalVariations: variations.length,
		totalLevels: levelCap(variations),
		level1TaskCount: levelTaskVariations(variations, 1).length
	};
}

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
 * Applies one completed attempt's outcome to a level's run: marks the
 * attempted task cleared, or requeues it to the back on a mistake instead —
 * advancing to the next level once every task is cleared. Demotion is
 * handled entirely separately by `resolvePreviousLevelMistake` — this
 * function never demotes, so a task that's failed but never finished
 * doesn't need to complete before a mistake made on it can count.
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

	const queue = row.queue.map((entry) =>
		entry.key === result.taskKey && !result.hadMistake ? { ...entry, status: 'cleared' as const } : entry
	);
	const reordered = result.hadMistake
		? [...queue.filter((e) => e.key !== result.taskKey), queue.find((e) => e.key === result.taskKey)!]
		: queue;

	return advanceIfCleared({ ...row, queue: reordered }, variations, cap, random);
}

/**
 * Applies a single previous-level-band mistake the instant it happens —
 * not batched until some attempt eventually completes, since a player who
 * keeps failing the same move and never gets it right would otherwise never
 * trigger a demotion no matter how many times they fail it. Demotes at the
 * 3-strikes threshold (discarding the departing level's queue and resetting
 * the counter), or just increments the counter otherwise. There's nothing
 * to demote below level 1 (no `previous` band exists there) or once
 * mastered — both are no-ops.
 */
export function resolvePreviousLevelMistake(
	row: LevelProgressRow,
	variations: Variation[],
	random: () => number = Math.random
): MistakeOutcome {
	const cap = levelCap(variations);
	if (row.level > cap || row.level <= 1) return { row, demoted: false };

	const prevLevelMistakes = row.prevLevelMistakes + 1;
	if (prevLevelMistakes >= DEMOTION_THRESHOLD) {
		const demotedLevel = row.level - 1;
		return {
			row: { level: demotedLevel, prevLevelMistakes: 0, queue: buildQueue(variations, demotedLevel, random) },
			demoted: true
		};
	}

	return { row: { ...row, prevLevelMistakes }, demoted: false };
}

/**
 * Combines a repertoire's shape with its `level_progress` row (or `null` if
 * the player hasn't started it yet) into the summary both `/practice` (the
 * picker) and `/practice/[repertoire_id]` (the detail screen) need.
 * Read-only — never reconciles or persists; that's `syncLevelProgress`'s job.
 */
export function repertoireProgressFromShape(shape: RepertoireShape, row: LevelProgressRow | null): RepertoireProgress {
	if (shape.totalVariations === 0) {
		return { level: 'mastered', totalVariations: 0, totalLevels: 0, levelTaskCount: 0, levelSolvedCount: 0 };
	}
	if (!row) {
		return {
			level: 1,
			totalVariations: shape.totalVariations,
			totalLevels: shape.totalLevels,
			levelTaskCount: shape.level1TaskCount,
			levelSolvedCount: 0
		};
	}
	return {
		level: row.level > shape.totalLevels ? 'mastered' : row.level,
		totalVariations: shape.totalVariations,
		totalLevels: shape.totalLevels,
		levelTaskCount: row.queue.length,
		levelSolvedCount: row.queue.filter((e) => e.status === 'cleared').length
	};
}

/**
 * Same as `repertoireProgressFromShape`, but computes the shape from raw
 * variations first — for callers (the practice detail page) that already
 * need the full enumerated tree for other reasons (building queues,
 * resolving attempts) and don't have a cached shape to reuse.
 */
export function repertoireProgress(variations: Variation[], row: LevelProgressRow | null): RepertoireProgress {
	return repertoireProgressFromShape(repertoireShape(variations), row);
}
