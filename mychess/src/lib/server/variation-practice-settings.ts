// mychess/src/lib/server/variation-practice-settings.ts
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Sets whether `variationKeys` are included in practice for `playerId`,
 * within `repertoireId`. `included: true` deletes any existing exclusion
 * rows (back to the default "included"); `included: false` upserts one
 * exclusion row per key (deduped first — see below). No-ops on an empty
 * `variationKeys` array.
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
		const { error } = await supabase
			.from('variation_practice_exclusions')
			.delete()
			.eq('player_id', playerId)
			.in('variation_key', variationKeys);
		return { error: error?.message ?? null };
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
	const { error } = await supabase
		.from('variation_practice_exclusions')
		.upsert(rows, { onConflict: 'player_id,variation_key' });
	return { error: error?.message ?? null };
}
