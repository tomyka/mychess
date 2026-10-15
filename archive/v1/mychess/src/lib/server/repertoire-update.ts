// mychess/src/lib/server/repertoire-update.ts
//
// Claiming a repertoire for an atomic reshape, and the staleness bound on that
// claim. Both sides of the `repertoires.update_in_progress_at` flag.
//
// This file used to also build the coach re-upload's review preview (GitHub
// issue #118). That subsystem was removed in #211; what survives is the claim,
// which the chapter manager
// (`/coach/repertoires/[repertoire_id]/chapters`) takes before calling the
// `apply_repertoire_update` RPC. The "update" vocabulary is kept deliberately
// — the RPC and the column are both named for it, and inventing a second word
// here would only hide the connection.

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * How long `repertoires.update_in_progress_at` is honoured before it is
 * treated as the residue of a crashed apply. Exported so reconciliation
 * compares against this exact value rather than its own copy of it — the two
 * sides deciding "stale" differently is how a repertoire wedges forever (or
 * reconciles against a half-applied shape, which is worse).
 */
export const UPDATE_FLAG_STALE_MS = 10 * 60 * 1000;

/**
 * Claims the repertoire for an apply, returning false when its shape has moved
 * since the caller resolved the move ids it is about to submit — the caller
 * must then refuse to apply and start over, because every move id it holds was
 * resolved against a shape that no longer exists.
 *
 * ONE conditional UPDATE on purpose. A read-then-write would leave a window
 * between reading `moves_updated_at` and setting the flag in which a second
 * apply could land its own upsert, bumping `moves_updated_at` (0055's
 * triggers), and both applies would believe they were current. Postgres
 * evaluates the `.eq('moves_updated_at', ...)` predicate and the write in one
 * statement, so the check and the claim cannot be split.
 *
 * The stamped timestamp is a JS clock reading, used ONLY as a staleness marker
 * measured against `UPDATE_FLAG_STALE_MS` — it is never compared against a
 * database clock or against `moves_updated_at`, so client/server clock skew
 * cannot make it mean the wrong thing. (`moves_updated_at`, the value that IS
 * compared, is written by the database and only ever read back verbatim.)
 */
export async function beginUpdate(
	supabase: SupabaseClient,
	repertoireId: string,
	expectedMovesUpdatedAt: string
): Promise<boolean> {
	const { data } = await supabase
		.from('repertoires')
		.update({ update_in_progress_at: new Date().toISOString() })
		.eq('id', repertoireId)
		.eq('moves_updated_at', expectedMovesUpdatedAt)
		.select('id');
	return (data?.length ?? 0) > 0;
}
