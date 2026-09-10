// mychess/src/lib/server/active-openings.ts
//
// Reading and writing `active_opening_repertoires` (GitHub issue #202). The
// derivation lives in src/lib/openings/active.ts; this file is the I/O.
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOpening } from '$lib/openings/resolve';
import {
  activeByOpening,
  planActiveOpeningRepoint,
  REPERTOIRE_OPENING_COLUMNS,
  type ActiveOpeningRow,
  type ResolvableRepertoire
} from '$lib/openings/active';

type ActivationParams = { playerId: string; repertoireId: string; setBy: string };
type ActivationResult = { error: string | null };

/**
 * The repertoire's four resolvable columns, for someone entitled to set this
 * student's active opening.
 *
 * Tries the caller's own read first, which covers every case where the person
 * acting owns the repertoire — the overwhelmingly common one. Only when that
 * returns nothing does it fall back to `repertoire_opening_source`, a
 * `security definer` read gated on the same two predicates the insert policy
 * uses (GitHub issue #209).
 *
 * That order matters. `repertoires`' RLS does not let a coach see a student's
 * OWN upload, so the plain read returned nothing and the coach got "Repertoire
 * not found" for a write the policy would have allowed. Going through the
 * gated read only on that path means this keeps working unchanged wherever the
 * plain read already succeeded, including before migration 0080 is applied.
 */
async function readOpeningSource(
  supabase: SupabaseClient,
  params: ActivationParams
): Promise<ResolvableRepertoire | null> {
  const { data: own } = await supabase
    .from('repertoires')
    .select(REPERTOIRE_OPENING_COLUMNS)
    .eq('id', params.repertoireId)
    .maybeSingle();
  if (own) return own as unknown as ResolvableRepertoire;

  const { data: gated } = await supabase.rpc('repertoire_opening_source', {
    p_repertoire_id: params.repertoireId,
    p_player_id: params.playerId
  });
  const row = (gated as ResolvableRepertoire[] | null)?.[0];
  return row ?? null;
}

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
  const repertoire = await readOpeningSource(supabase, params);
  if (!repertoire) return { error: 'Repertoire not found' };

  const opening = resolveOpening(repertoire);
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
 * Follow every active mapping for this repertoire to wherever it now resolves
 * (GitHub issue #210). Call after ANY write that changes what `resolveOpening`
 * answers — the coach's `opening_id` override, or the owner's `eco_code`.
 *
 * Without this the rows keep naming the old opening, read as stale, and are
 * silently dropped: every student holding that repertoire loses their active
 * preparation because of what looked like a correction.
 *
 * Best-effort and self-logging, like `activateOpeningIfUnset`: the
 * reclassification itself has already succeeded by the time this runs, and
 * failing it afterwards would be the worse outcome.
 */
export async function repointActiveOpenings(supabase: SupabaseClient, repertoireId: string): Promise<void> {
  const { data: repertoire } = await supabase
    .from('repertoires')
    .select(REPERTOIRE_OPENING_COLUMNS)
    .eq('id', repertoireId)
    .maybeSingle();
  if (!repertoire) return;

  const { data } = await supabase
    .from('active_opening_repertoires')
    .select('opening_id, repertoire_id')
    .eq('repertoire_id', repertoireId);
  const rows = (data ?? []) as ActiveOpeningRow[];
  if (rows.length === 0) return;

  const opening = resolveOpening(repertoire as unknown as ResolvableRepertoire);
  const { repoint, remove } = planActiveOpeningRepoint(rows, opening?.id ?? null);

  for (const row of remove) {
    const { error } = await supabase
      .from('active_opening_repertoires')
      .delete()
      .eq('repertoire_id', repertoireId)
      .eq('opening_id', row.opening_id);
    if (error) console.error(`Failed to drop the active opening for repertoire ${repertoireId}:`, error.message);
  }

  for (const row of repoint) {
    const { error } = await supabase
      .from('active_opening_repertoires')
      .update({ opening_id: opening!.id, updated_at: new Date().toISOString() })
      .eq('repertoire_id', repertoireId)
      .eq('opening_id', row.opening_id);
    if (!error) continue;

    // The student already has a different active repertoire for the
    // destination opening, and the primary key refuses a second. Incumbent
    // wins, matching the rule everywhere else here: a later arrival never
    // displaces a standing choice. The moving row is dropped rather than left
    // pointing at an opening this repertoire no longer prepares.
    const { error: dropError } = await supabase
      .from('active_opening_repertoires')
      .delete()
      .eq('repertoire_id', repertoireId)
      .eq('opening_id', row.opening_id);
    if (dropError) {
      console.error(`Failed to resolve an active-opening collision for repertoire ${repertoireId}:`, dropError.message);
    }
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
