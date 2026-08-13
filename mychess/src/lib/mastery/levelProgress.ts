// mychess/src/lib/mastery/levelProgress.ts
import type { Variation } from './variations';
import { levelCap, levelTaskVariations, taskKey, type Level } from './levels';

export type QueueEntry = { key: string; status: 'pending' | 'cleared' };
export type LevelProgressRow = {
	level: number;
	prevLevelMistakes: number;
	queue: QueueEntry[];
	// Which ONE variation level/queue currently track — see
	// src/lib/mastery/variationSequence.ts (Task 4). Optional (not required) so
	// the many pre-existing test fixtures across this file and practice.test.ts
	// that hand-construct rows without caring about sequencing don't all need
	// updating — an omitted value is treated identically to `null`
	// (`pickActiveVariation` falls back to the first variation) everywhere
	// it's read.
	activeVariationKey?: string | null;
};
export type AttemptResult = {
	taskKey: string;
	hadMistake: boolean;
	// Set when a mid-attempt branch (an 'alternatives' pick, see
	// $lib/mastery/practice.ts) moved the player onto a DIFFERENT line than
	// the one this attempt originally pinned — that original task otherwise
	// never gets any outcome recorded at all (not cleared, not mistake-
	// requeued), so if it's still `pending` it stays the FIFO queue's head
	// forever. If the player consistently branches away from it the same
	// way (e.g. its very first move has an obvious alternative that leads
	// into already-mastered content), the SAME already-cleared task keeps
	// getting credited every attempt while this one never budges — see
	// resolveAttempt.
	abandonedTaskKey?: string;
};
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

export function repertoireShape(variations: Variation[], chunkSize: number): RepertoireShape {
	return {
		totalVariations: variations.length,
		totalLevels: levelCap(variations, chunkSize),
		level1TaskCount: levelTaskVariations(variations, 1, chunkSize).length
	};
}

/**
 * The level a player can actually progress to right now: whichever is
 * smaller of the repertoire's real content depth and their own configured
 * `practice_depth_levels` (see the repertoires column of the same name).
 * The full repertoire is always imported — this is a practice-time ceiling
 * the player can raise later to reveal deeper content that was there all
 * along, not a limit on what's stored.
 */
export function effectiveLevelCap(variations: Variation[], maxLevel: number, chunkSize: number): number {
	return Math.min(levelCap(variations, chunkSize), maxLevel);
}

const DEMOTION_THRESHOLD = 3;

/** A freshly shuffled, all-pending queue for every task at `level`. */
export function buildQueue(
	variations: Variation[],
	level: Level,
	chunkSize: number,
	random: () => number = Math.random
): QueueEntry[] {
	const keys = levelTaskVariations(variations, level, chunkSize).map((v) => taskKey(v, level, chunkSize));
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
export function reconcileQueue(queue: QueueEntry[], variations: Variation[], level: Level, chunkSize: number): QueueEntry[] {
	const freshKeys = new Set(levelTaskVariations(variations, level, chunkSize).map((v) => taskKey(v, level, chunkSize)));
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
	chunkSize: number,
	random: () => number
): LevelProgressRow {
	if (!isFullyCleared(row.queue)) return row;
	const nextLevel = row.level + 1;
	if (nextLevel > cap) return { ...row, level: nextLevel, prevLevelMistakes: 0 };
	return { ...row, level: nextLevel, prevLevelMistakes: 0, queue: buildQueue(variations, nextLevel, chunkSize, random) };
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
	maxLevel: number,
	chunkSize: number,
	random: () => number = Math.random
): LevelProgressRow {
	const cap = effectiveLevelCap(variations, maxLevel, chunkSize);
	if (row.level > cap) return row; // already mastered — nothing to reconcile
	const reconciled = { ...row, queue: reconcileQueue(row.queue, variations, row.level, chunkSize) };
	return advanceIfCleared(reconciled, variations, cap, chunkSize, random);
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
	maxLevel: number,
	chunkSize: number,
	random: () => number = Math.random
): LevelProgressRow {
	const cap = effectiveLevelCap(variations, maxLevel, chunkSize);
	if (row.level > cap) return row; // already mastered — a stale/replayed report is a no-op
	if (!row.queue.some((entry) => entry.key === result.taskKey)) return row; // stale/unrecognized task — no-op

	const queue = row.queue.map((entry) =>
		entry.key === result.taskKey && !result.hadMistake ? { ...entry, status: 'cleared' as const } : entry
	);
	let reordered = result.hadMistake
		? [...queue.filter((e) => e.key !== result.taskKey), queue.find((e) => e.key === result.taskKey)!]
		: queue;

	// The abandoned original pin never got an outcome of its own — send it
	// to the back too, same as a mistake, so pickQueuedAttempt's FIFO moves
	// on instead of re-serving it next. Only matters while still `pending`:
	// if some earlier attempt already cleared it (or it doesn't exist in
	// this queue at all — a stale/reconciled key), there's nothing to move.
	if (result.abandonedTaskKey && result.abandonedTaskKey !== result.taskKey) {
		const abandoned = reordered.find((e) => e.key === result.abandonedTaskKey && e.status === 'pending');
		if (abandoned) reordered = [...reordered.filter((e) => e !== abandoned), abandoned];
	}

	return advanceIfCleared({ ...row, queue: reordered }, variations, cap, chunkSize, random);
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
	maxLevel: number,
	chunkSize: number,
	random: () => number = Math.random
): MistakeOutcome {
	const cap = effectiveLevelCap(variations, maxLevel, chunkSize);
	if (row.level > cap || row.level <= 1) return { row, demoted: false };

	const prevLevelMistakes = row.prevLevelMistakes + 1;
	if (prevLevelMistakes >= DEMOTION_THRESHOLD) {
		const demotedLevel = row.level - 1;
		return {
			row: { ...row, level: demotedLevel, prevLevelMistakes: 0, queue: buildQueue(variations, demotedLevel, chunkSize, random) },
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
 * resolving attempts) and don't have a cached shape to reuse. `maxLevel`
 * clamps `totalLevels` to the player's configured practice depth, same as
 * `effectiveLevelCap`.
 */
export function repertoireProgress(
	variations: Variation[],
	row: LevelProgressRow | null,
	maxLevel: number,
	chunkSize: number
): RepertoireProgress {
	const shape = repertoireShape(variations, chunkSize);
	return repertoireProgressFromShape({ ...shape, totalLevels: Math.min(shape.totalLevels, maxLevel) }, row);
}

export type ReviewFreshness = 'fresh' | 'due-soon' | 'overdue';

const FRESH_MAX_DAYS = 14;
const DUE_SOON_MAX_DAYS = 30;

/**
 * How urgently a mastered repertoire needs a maintenance review — mastering
 * every level isn't a finish line, since memory fades over time regardless
 * of level. `null` (never reviewed since mastering) is treated as the most
 * overdue state rather than "fresh", so a repertoire doesn't sit unreviewed
 * forever just because it happened to be mastered before this feature
 * existed.
 */
export function reviewFreshness(lastReviewedAt: string | null, now: Date): ReviewFreshness {
	if (lastReviewedAt === null) return 'overdue';
	const days = (now.getTime() - new Date(lastReviewedAt).getTime()) / (1000 * 60 * 60 * 24);
	if (days < FRESH_MAX_DAYS) return 'fresh';
	if (days < DUE_SOON_MAX_DAYS) return 'due-soon';
	return 'overdue';
}

/**
 * A shuffled sample of up to `sessionSize` distinct levels from 1..totalLevels
 * — the sequence a maintenance review session walks through, one task per
 * level, so a "quick refresher" touches a spread of the repertoire instead
 * of drilling one level repeatedly. Every level, not just a slice, is a
 * candidate — capped at `sessionSize` so refreshing a huge repertoire still
 * takes minutes, not the length of the whole thing.
 */
export function pickMaintenanceLevels(
	totalLevels: number,
	sessionSize: number,
	random: () => number = Math.random
): number[] {
	const levels = Array.from({ length: totalLevels }, (_, i) => i + 1);
	for (let i = levels.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[levels[i], levels[j]] = [levels[j], levels[i]];
	}
	return levels.slice(0, Math.min(sessionSize, levels.length));
}
