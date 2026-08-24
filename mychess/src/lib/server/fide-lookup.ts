import type { SupabaseClient } from '@supabase/supabase-js';
import { mapFideRow, type FideRatingProfile } from '$lib/fide/rank';

export type FideLookupResult = { query: string; found: boolean; player?: FideRatingProfile };

const FIDE_PLAYER_COLUMNS =
  'fide_id, name, std_rating, rapid_rating, blitz_rating, country_rank_standard, country_rank_rapid, country_rank_blitz, age_bracket, age_group_rank_standard, age_group_rank_rapid, age_group_rank_blitz, europe_age_group_rank_standard, europe_age_group_rank_rapid, europe_age_group_rank_blitz';

/**
 * Looks up one FIDE player by id from the public `fide_players` table, for
 * the "search a player" lookup card — shared by the signed-out landing page
 * and the signed-in Players page rather than duplicated between them.
 */
export async function loadFideLookup(
  supabase: SupabaseClient,
  fideId: string
): Promise<FideLookupResult | null> {
  const query = fideId.trim();
  if (!query) return null;
  const { data: row } = await supabase
    .from('fide_players')
    .select(FIDE_PLAYER_COLUMNS)
    .eq('fide_id', query)
    .single();
  return row ? { query, found: true, player: mapFideRow(row as any) } : { query, found: false };
}
