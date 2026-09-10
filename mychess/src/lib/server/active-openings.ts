// mychess/src/lib/server/active-openings.ts
//
// Reading and writing `active_opening_repertoires` (GitHub issue #202). The
// derivation lives in src/lib/openings/active.ts; this file is the I/O.
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOpening } from '$lib/openings/resolve';
import {
  activeByOpening,
  REPERTOIRE_OPENING_COLUMNS,
  type ActiveOpeningRow,
  type ResolvableRepertoire
} from '$lib/openings/active';

type ActivationParams = { playerId: string; repertoireId: string; setBy: string };
type ActivationResult = { error: string | null };

/**
 * Which opening a repertoire prepares is resolved HERE, in application code,
 * and never in SQL. `repertoires.opening_id` holds only a coach's explicit
 * override and is null on almost every row, so a `where opening_id = ...`
 * would silently miss the majority (see the note on issue #202).
 */
async function writeActive(
  supabase: SupabaseClient,
  params: ActivationParams,
  ignoreDuplicates: boolean
): Promise<ActivationResult> {
  const { data: repertoire } = await supabase
    .from('repertoires')
    .select(REPERTOIRE_OPENING_COLUMNS)
    .eq('id', params.repertoireId)
    .maybeSingle();
  if (!repertoire) return { error: 'Repertoire not found' };

  const opening = resolveOpening(repertoire as unknown as ResolvableRepertoire);
  if (!opening) return { error: 'That repertoire has no curated opening' };

  const { error } = await supabase.from('active_opening_repertoires').upsert(
    {
      player_id: params.playerId,
      opening_id: opening.id,
      repertoire_id: params.repertoireId,
      set_by: params.setBy,
      updated_at: new Date().toISOString()
    },
    // Explicit, per this project's upsert rule: a bare upsert targets the
    // primary key, which happens to be these columns today but would stop
    // being true the moment the key changes.
    { onConflict: 'player_id,opening_id', ignoreDuplicates }
  );

  return { error: error?.message ?? null };
}

/** Make this repertoire the student's active preparation, displacing any other. */
export function setActiveOpening(supabase: SupabaseClient, params: ActivationParams): Promise<ActivationResult> {
  return writeActive(supabase, params, false);
}

/**
 * Make it active only if that opening has no active repertoire yet.
 *
 * "Does not displace an existing choice" is `ignoreDuplicates`, i.e. a database
 * no-op, rather than a read-then-write that two coaches could race.
 *
 * Best-effort by design, and so it returns nothing. Both callers reach it only
 * after the row they actually care about is written — a repertoire, an
 * assignment — and failing that work over a mapping would be the far worse
 * outcome. The swallow-and-log therefore lives here, once, instead of being
 * copied into every caller.
 */
export async function activateOpeningIfUnset(
  supabase: SupabaseClient,
  params: ActivationParams
): Promise<void> {
  const { error } = await writeActive(supabase, params, true);
  if (error) {
    console.error(`Failed to set the active opening for repertoire ${params.repertoireId}:`, error);
  }
}

/**
 * The student's active repertoire per opening. Rows whose repertoire the caller
 * cannot read come back with a null embed and are dropped as stale, which is
 * what a coach sees for a repertoire their student uploaded themselves.
 */
export async function loadActiveOpenings(
  supabase: SupabaseClient,
  playerId: string
): Promise<Map<string, ResolvableRepertoire>> {
  const { data } = await supabase
    .from('active_opening_repertoires')
    .select(`opening_id, repertoire_id, repertoire:repertoire_id(${REPERTOIRE_OPENING_COLUMNS})`)
    .eq('player_id', playerId);

  const rows = (data ?? []) as unknown as (ActiveOpeningRow & { repertoire: ResolvableRepertoire | null })[];
  return activeByOpening(
    rows.map((row) => row.repertoire).filter((repertoire): repertoire is ResolvableRepertoire => !!repertoire),
    rows.map((row) => ({ opening_id: row.opening_id, repertoire_id: row.repertoire_id }))
  );
}
