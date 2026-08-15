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

/** Best-effort compensation for a delete batch that already succeeded before a later batch failed — re-excludes exactly those keys. */
async function reinsertExclusions(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKeys: string[]
): Promise<void> {
	if (variationKeys.length === 0) return;
	const rows = variationKeys.map((variationKey) => ({
		player_id: playerId,
		repertoire_id: repertoireId,
		variation_key: variationKey
	}));
	for (const batch of chunk(rows, BATCH_SIZE)) {
		await supabase.from('variation_practice_exclusions').upsert(batch, { onConflict: 'player_id,variation_key' });
	}
}

/** Best-effort compensation for an upsert batch that already succeeded before a later batch failed — re-deletes exactly those keys' exclusion rows. */
async function deleteExclusions(supabase: SupabaseClient, playerId: string, variationKeys: string[]): Promise<void> {
	if (variationKeys.length === 0) return;
	for (const batch of chunk(variationKeys, BATCH_SIZE)) {
		await supabase.from('variation_practice_exclusions').delete().eq('player_id', playerId).in('variation_key', batch);
	}
}

/**
 * Sets whether `variationKeys` are included in practice for `playerId`,
 * within `repertoireId`. `included: true` deletes any existing exclusion
 * rows (back to the default "included"); `included: false` upserts one
 * exclusion row per key (deduped first — see below). No-ops on an empty
 * `variationKeys` array. Batches the underlying delete/upsert into groups of
 * `BATCH_SIZE` keys, running sequentially and stopping at the first error.
 *
 * A caller that fails gets back a single error and reverts its own state to
 * "nothing changed" — so if an earlier batch in this same call already
 * committed before a later one failed, the call rolls that batch back
 * (a best-effort compensating write, not a real transaction) rather than
 * leaving the database silently ahead of what every caller believes
 * happened. Without this, a large enough bulk toggle (more than
 * `BATCH_SIZE` keys — a chapter-level or whole-repertoire checkbox) that
 * fails partway through would leave some variations actually toggled server-
 * side while the UI reverts to showing none of them as changed.
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
		const succeededKeys: string[] = [];
		for (const batch of chunk(variationKeys, BATCH_SIZE)) {
			const { error } = await supabase
				.from('variation_practice_exclusions')
				.delete()
				.eq('player_id', playerId)
				.in('variation_key', batch);
			if (error) {
				await reinsertExclusions(supabase, playerId, repertoireId, succeededKeys);
				return { error: error.message };
			}
			succeededKeys.push(...batch);
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
	const succeededKeys: string[] = [];
	for (const batch of chunk(rows, BATCH_SIZE)) {
		const { error } = await supabase
			.from('variation_practice_exclusions')
			.upsert(batch, { onConflict: 'player_id,variation_key' });
		if (error) {
			await deleteExclusions(supabase, playerId, succeededKeys);
			return { error: error.message };
		}
		succeededKeys.push(...batch.map((r) => r.variation_key));
	}
	return { error: null };
}
