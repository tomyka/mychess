import { Chess } from 'chess.js';
import type { VariationStep } from './variations';

/** How many of the player's own moves make up one teaching batch. */
export const TEACHING_BATCH_MOVES = 5;

export type TeachingStep = {
	path: VariationStep[];
	arrowPlies: { from: number; to: number } | null;
	isFinalPass: boolean;
};

/**
 * The ply index right after the `moveCount`-th player-turn ply found at or
 * after `fromPly` — i.e. where a batch of `moveCount` player moves ends.
 * Deliberately NOT a fixed ply-count offset: whether a batch of N player
 * moves spans N*2-1, N*2, or fewer plies depends entirely on whose move
 * `fromPly` itself lands on. What matters is that the result always points
 * just past a PLAYER move (or the end of the path, if it runs out first) —
 * never an opponent reply. A served path ending on the opponent's move would
 * mean the player is never asked to move at that path's last index, so the
 * "was that the final move of this attempt" check in the practice page (only
 * ever evaluated when the player themselves moves) would never fire, and the
 * attempt would silently complete without ever reporting its outcome.
 */
function plyAfterPlayerMoves(path: VariationStep[], fromPly: number, moveCount: number): number {
	let seen = 0;
	for (let i = fromPly; i < path.length; i++) {
		if (path[i].isPlayerTurn) {
			seen++;
			if (seen >= moveCount) return i + 1;
		}
	}
	return path.length;
}

/**
 * Derives what the NEXT attempt of this variation should look like, purely
 * from its two persisted counters — never from a stored "phase" — so a
 * corrupted or stale counter can't disagree with what's actually served. See
 * docs/superpowers/specs/2026-08-14-variation-teaching-arrows-design.md for
 * the full state-machine rationale.
 */
export function resolveTeachingStep(path: VariationStep[], taughtPlies: number, masteredPlies: number): TeachingStep {
	if (masteredPlies >= path.length) {
		return { path, arrowPlies: null, isFinalPass: true };
	}
	if (taughtPlies === masteredPlies) {
		const target = plyAfterPlayerMoves(path, masteredPlies, TEACHING_BATCH_MOVES);
		return { path: path.slice(0, target), arrowPlies: { from: masteredPlies, to: target }, isFinalPass: false };
	}
	return { path: path.slice(0, taughtPlies), arrowPlies: null, isFinalPass: taughtPlies >= path.length };
}

/**
 * Applies a completed attempt's outcome to the two counters. Always
 * re-derives the step that was actually served (via `resolveTeachingStep`)
 * rather than trusting anything the client reports beyond `hadMistake` — the
 * same trust boundary `applyAttemptResult` already has today.
 */
export function advanceTeachingProgress(
	path: VariationStep[],
	taughtPlies: number,
	masteredPlies: number,
	hadMistake: boolean
): { taughtPlies: number; masteredPlies: number; solved: boolean } {
	const step = resolveTeachingStep(path, taughtPlies, masteredPlies);

	if (hadMistake) {
		return { taughtPlies, masteredPlies, solved: false };
	}
	if (step.arrowPlies) {
		return { taughtPlies: step.arrowPlies.to, masteredPlies, solved: false };
	}
	return { taughtPlies: Math.max(taughtPlies, step.path.length), masteredPlies: step.path.length, solved: step.isFinalPass };
}

/**
 * The current ply's arrow — the move's own origin/destination squares, or
 * null if this ply isn't inside the served arrow range, isn't the player's
 * own move (arrows never point at the opponent's reply), or the move can't
 * be parsed. Mirrors the existing hintSquare derivation's try/catch shape in
 * +page.svelte.
 */
export function arrowMoveForStep(
	step: VariationStep,
	plyIndex: number,
	arrowPlies: { from: number; to: number } | null
): { from: string; to: string } | null {
	if (!arrowPlies || plyIndex < arrowPlies.from || plyIndex >= arrowPlies.to || !step.isPlayerTurn) return null;
	try {
		const move = new Chess(step.fromFen).move(step.san);
		return move ? { from: move.from, to: move.to } : null;
	} catch {
		return null;
	}
}
