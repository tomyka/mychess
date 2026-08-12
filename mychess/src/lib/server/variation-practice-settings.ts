// mychess/src/lib/server/variation-practice-settings.ts
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Sets whether `variationKeys` are included in practice for `playerId`,
 * within `repertoireId`. `included: true` deletes any existing exclusion
 * rows (back to the default "included"); `included: false` upserts one
 * exclusion row per key. No-ops on an empty `variationKeys` array.
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

	const rows = variationKeys.map((variationKey) => ({
		player_id: playerId,
		repertoire_id: repertoireId,
		variation_key: variationKey
	}));
	const { error } = await supabase
		.from('variation_practice_exclusions')
		.upsert(rows, { onConflict: 'player_id,variation_key' });
	return { error: error?.message ?? null };
}
