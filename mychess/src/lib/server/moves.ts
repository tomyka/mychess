// mychess/src/lib/server/moves.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPages, MAX_ROWS_PAGE_SIZE } from './paginate';

/**
 * Every live (non-retired) move row for one or many repertoires, paginated
 * past PostgREST's `max_rows` cap (see paginate.ts) — the one shared
 * implementation of a query that used to be duplicated, each with its own
 * `retired_at` filter, across practice-repertoire.ts, repertoire-progress.ts,
 * and the practice/learn page loads.
 *
 * Retired rows are excluded unconditionally: a retired row is a line a coach
 * removed — today, only by removing its chapter. It is retired rather than
 * deleted so the student's `reviews`/`move_attempts` history against it is not
 * destroyed, but note that nothing can un-retire a move any more: the flow
 * that did was removed with the re-upload subsystem (#211), and the surviving
 * caller of `apply_repertoire_update` always passes an empty
 * `p_unretire_move_ids`. Retiring is one-way until something restores it.
 *
 * A retired row must never resurface as something to enumerate, drill,
 * time-trial, or count.
 *
 * Ordered by `created_at`, then `import_order`, then `id` (a final
 * tie-break, since `moves.id` is a random UUID and carries no order of its
 * own) so pagination is deterministic and each chapter surfaces in its true
 * import order. See `moves.import_order`'s own column comment (migration
 * 0073) for why `created_at` alone isn't enough to guarantee that.
 */
export async function fetchLiveMoves(
	supabase: SupabaseClient,
	repertoireIds: string | readonly string[],
	columns: string,
	{ playerTurnOnly = false }: { playerTurnOnly?: boolean } = {}
): Promise<any[]> {
	// A single id always scopes with `.eq()`, an array always with `.in()` —
	// callers use one shape or the other deliberately (a single-repertoire
	// read vs. a batched multi-repertoire one), so this must not collapse a
	// one-element array onto `.eq()`: that would make the two indistinguishable
	// from a query-shape standpoint even though they mean different things.
	const scoped = (q: any) => {
		const scopedToRepertoires =
			typeof repertoireIds === 'string' ? q.eq('repertoire_id', repertoireIds) : q.in('repertoire_id', repertoireIds);
		return playerTurnOnly ? scopedToRepertoires.eq('is_player_turn', true) : scopedToRepertoires;
	};
	return fetchAllPages(
		() =>
			scoped(supabase.from('moves').select(columns))
				.is('retired_at', null)
				.order('created_at', { ascending: true })
				.order('import_order', { ascending: true, nullsFirst: false })
				.order('id', { ascending: true }),
		() => scoped(supabase.from('moves').select('id', { count: 'exact', head: true })).is('retired_at', null),
		MAX_ROWS_PAGE_SIZE
	);
}
