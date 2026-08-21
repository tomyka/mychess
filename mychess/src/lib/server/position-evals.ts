// mychess/src/lib/server/position-evals.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { ENGINE_ID } from '$lib/engine/version';
import type { EngineScore } from '$lib/engine/uci';

/** FEN → white-relative score, for whatever subset of `fens` has a CURRENT eval. */
export type PositionEvals = Record<string, EngineScore>;

/**
 * Loads precomputed evaluations for the given FENs (issue #126).
 *
 * Rows stamped with a different `eval_engine` are left out rather than returned:
 * a stale eval must read as "no eval" so the bar shows its neutral state,
 * never a number the current engine wouldn't agree with. Same for a row whose
 * score is null, which is how `scripts/eval-positions.ts` records a position
 * that is already over (mate or stalemate on the board).
 *
 * Chunked because a FEN list goes into a URL: `positions` is global (one row per
 * FEN), so this is a plain `in` filter with no per-player scoping to get wrong.
 */
export async function loadPositionEvals(supabase: SupabaseClient, fens: readonly string[]): Promise<PositionEvals> {
	const unique = [...new Set(fens.filter(Boolean))];
	if (unique.length === 0) return {};

	// Keeps the request URL well inside limits for a long variation.
	const CHUNK = 100;
	const evals: PositionEvals = {};
	for (let i = 0; i < unique.length; i += CHUNK) {
		const { data, error } = await supabase
			.from('positions')
			.select('fen, eval_cp, eval_mate')
			.eq('eval_engine', ENGINE_ID)
			.in('fen', unique.slice(i, i + CHUNK));
		// A failure here costs the bar its number and nothing else, so it must not
		// take the drill page down with it.
		if (error) {
			console.error('position evals: load failed:', error);
			return evals;
		}
		for (const row of data ?? []) {
			if (row.eval_mate !== null && row.eval_mate !== undefined) evals[row.fen] = { mate: row.eval_mate };
			else if (row.eval_cp !== null && row.eval_cp !== undefined) evals[row.fen] = { cp: row.eval_cp };
		}
	}
	return evals;
}

/** Every position a served attempt can put on the board: each step's before and after. */
export function fensInPath(path: readonly { fromFen: string; toFen: string }[]): string[] {
	const fens: string[] = [];
	for (const step of path) {
		fens.push(step.fromFen, step.toFen);
	}
	return fens;
}
