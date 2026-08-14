// mychess/src/lib/server/variation-practice-settings.ts
import type { SupabaseClient } from '@supabase/supabase-js';

// `variation_key` is a `>`-joined chain of the line's own move UUIDs (see
// `enumerateVariations` in `$lib/mastery/variations`), so a deep opening
// line's key can run to hundreds of characters — and a `.in()` filter goes
// out as URL query text regardless of HTTP verb (PostgREST convention), not
// a request body. A single chapter-level bulk toggle can carry hundreds of
// keys at once (this UI's whole point is bulk-selecting a chapter's worth of
// variations in one click), so an unbatched `.in()` filter risks blowing past
// a proxy/URL length limit for a large, deep chapter. Batching keeps each
// underlying request's filter to a bounded size regardless of how many keys
// the caller passes in.
const BATCH_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
	const batches: T[][] = [];
	for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
	return batches;
}

/**
 * Sets whether `variationKeys` are included in practice for `playerId`,
 * within `repertoireId`. `included: true` deletes any existing exclusion
 * rows (back to the default "included"); `included: false` upserts one
 * exclusion row per key (deduped first — see below). No-ops on an empty
 * `variationKeys` array. Batches the underlying delete/upsert into groups of
 * `BATCH_SIZE` keys, running sequentially and stopping at the first error.
 *
 * `playerId` must be the authenticated caller's own id and `supabase` must
 * be the request-scoped, RLS-respecting client (never a service-role
 * client) — `variation_practice_exclusions_player_all`'s RLS policy is what
 * actually prevents writing another player's exclusions; this function
 * itself performs no ownership check of its own.
 */
export async function setVariationsIncluded(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKeys: string[],
	included: boolean
): Promise<{ error: string | null }> {
	if (variationKeys.length === 0) return { error: null };

	if (included) {
		for (const batch of chunk(variationKeys, BATCH_SIZE)) {
			const { error } = await supabase
				.from('variation_practice_exclusions')
				.delete()
				.eq('player_id', playerId)
				.in('variation_key', batch);
			if (error) return { error: error.message };
		}
		return { error: null };
	}

	// Dedupe first — a hierarchical checkbox UI's bulk parent-toggle and an
	// already-individually-toggled child variation can resolve to the same
	// key in one call, and Postgres rejects an upsert that would affect the
	// same conflict target twice within one statement.
	const rows = [...new Set(variationKeys)].map((variationKey) => ({
		player_id: playerId,
		repertoire_id: repertoireId,
		variation_key: variationKey
	}));
	for (const batch of chunk(rows, BATCH_SIZE)) {
		const { error } = await supabase
			.from('variation_practice_exclusions')
			.upsert(batch, { onConflict: 'player_id,variation_key' });
		if (error) return { error: error.message };
	}
	return { error: null };
}
