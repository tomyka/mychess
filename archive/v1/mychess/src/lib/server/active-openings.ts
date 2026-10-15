// mychess/src/lib/server/active-openings.ts
//
// Reading and writing `active_opening_repertoires` (GitHub issue #202). The
// derivation lives in src/lib/openings/active.ts; this file is the I/O.
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOpening } from '$lib/openings/resolve';
import { CURATED_OPENINGS, type CuratedOpening } from '$lib/openings/taxonomy';
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

  // `player_id` is selected because every write below is scoped to ONE row by
  // its full primary key. A statement scoped only by `repertoire_id` spans
  // every student holding the file, so one student's collision would fail the
  // whole update — and, worse, a blanket delete would then take every
  // student's mapping with it.
  const { data } = await supabase
    .from('active_opening_repertoires')
    .select('player_id, opening_id, repertoire_id')
    .eq('repertoire_id', repertoireId);
  const rows = (data ?? []) as (ActiveOpeningRow & { player_id: string })[];
  if (rows.length === 0) return;

  const opening = resolveOpening(repertoire as unknown as ResolvableRepertoire);
  const { repoint, remove } = planActiveOpeningRepoint(rows, opening?.id ?? null);

  const dropRow = (row: { player_id: string; opening_id: string }) =>
    supabase
      .from('active_opening_repertoires')
      .delete()
      .eq('player_id', row.player_id)
      .eq('opening_id', row.opening_id);

  for (const row of remove) {
    const { error } = await dropRow(row);
    if (error) console.error(`Failed to drop the active opening for repertoire ${repertoireId}:`, error.message);
  }

  for (const row of repoint) {
    const { error } = await supabase
      .from('active_opening_repertoires')
      .update({ opening_id: opening!.id, updated_at: new Date().toISOString() })
      .eq('player_id', row.player_id)
      .eq('opening_id', row.opening_id);
    if (!error) continue;

    // ONLY a unique violation means what the fallback assumes: this student
    // already has a different active repertoire for the destination opening,
    // and the primary key refuses a second. Incumbent wins, per the rule set
    // in #202 that a later arrival never displaces a standing choice.
    //
    // Any other error — RLS refusing the write, a transient failure — must
    // leave the row alone. Deleting on those would destroy the student's
    // preparation in exactly the situations where nothing was wrong with it.
    if (error.code !== '23505') {
      console.error(`Failed to repoint the active opening for repertoire ${repertoireId}:`, error.message);
      continue;
    }

    const { error: dropError } = await dropRow(row);
    if (dropError) {
      console.error(`Failed to resolve an active-opening collision for repertoire ${repertoireId}:`, dropError.message);
    }
  }
}

/**
 * Reclassify a repertoire by its ECO code, and carry its active mappings with
 * it.
 *
 * The owner is the only one who may do this, hence the `player_id` scope — RLS
 * enforces it too, but the filter turns a policy rejection into a plain
 * "changed nothing".
 *
 * Shared because the coach's repertoire list and the player's own list offer
 * the identical control and were, until this was extracted, byte-identical
 * copies down to the comment. Two copies of a write that must be followed by
 * `repointActiveOpenings` is exactly the shape in which one of them silently
 * loses that call (#210 was three call sites; the third was found only by
 * reading the file).
 */
export async function updateRepertoireEco(
  supabase: SupabaseClient,
  params: { ownerId: string; repertoireId: string; ecoCode: string | null; ecoName: string | null }
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('repertoires')
    .update({ eco_code: params.ecoCode, eco_name: params.ecoName })
    .eq('id', params.repertoireId)
    .eq('player_id', params.ownerId);
  if (error) return { error: error.message };

  // The ECO code is what `resolveOpening` derives from on almost every
  // repertoire, so editing it reclassifies the file as surely as the coach's
  // curated override does, and any active mapping must follow it (#210).
  await repointActiveOpenings(supabase, params.repertoireId);

  return { error: null };
}

/** One opening a student has current preparation for, and the file that is it. */
export type ActivePreparation = {
  opening: CuratedOpening;
  repertoire: ResolvableRepertoire & { name: string };
};

/**
 * A student's preparation, by opening rather than by filename — what the prep
 * view and the coverage report both read (GitHub issue #203).
 *
 * Read-only: neither surface records progress, which is epic #119's standing
 * non-goal, so nothing here writes.
 *
 * Openings the taxonomy no longer lists are dropped rather than rendered
 * nameless, on the same reasoning as the staleness rule — an entry that is
 * gone cannot be presented as this student's preparation.
 */
export async function loadActivePreparation(
  supabase: SupabaseClient,
  playerId: string
): Promise<ActivePreparation[]> {
  const { data } = await supabase
    .from('active_opening_repertoires')
    .select(`opening_id, repertoire_id, repertoire:repertoire_id(name, ${REPERTOIRE_OPENING_COLUMNS})`)
    .eq('player_id', playerId);

  type Row = ActiveOpeningRow & { repertoire: (ResolvableRepertoire & { name: string }) | null };
  const rows = (data ?? []) as unknown as Row[];

  const byOpening = activeByOpening(
    rows.map((row) => row.repertoire).filter((r): r is ResolvableRepertoire & { name: string } => !!r),
    rows.map((row) => ({ opening_id: row.opening_id, repertoire_id: row.repertoire_id }))
  );

  const prepared: ActivePreparation[] = [];
  for (const [openingId, repertoire] of byOpening) {
    const opening = CURATED_OPENINGS.find((entry) => entry.id === openingId);
    if (opening) prepared.push({ opening, repertoire });
  }
  return prepared;
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

  // A row whose embed is null is one whose repertoire the CALLER cannot read
  // — a coach looking at a repertoire the student uploaded themselves. Left
  // like this it would be dropped as unverifiable, and the coverage report
  // would then tell the coach the student has no preparation for an opening
  // they are in fact prepared for (GitHub issue #203).
  //
  // So when any embed is missing, re-read the lot through the gated function,
  // which resolves them under the same `manages_openings_for` rule the write
  // policy uses. Only on that path, so the ordinary case costs nothing — and
  // so this keeps working before migration 0080 is applied, just without the
  // self-uploaded rows, exactly as it behaves today.
  if (rows.some((row) => !row.repertoire)) {
    const gated = await readGatedActiveSources(supabase, playerId);
    if (gated) return gated;
  }

  return activeByOpening(
    rows.map((row) => row.repertoire).filter((repertoire): repertoire is ResolvableRepertoire => !!repertoire),
    rows.map((row) => ({ opening_id: row.opening_id, repertoire_id: row.repertoire_id }))
  );
}

/** The same map, read through `active_opening_sources`. Null if unavailable. */
async function readGatedActiveSources(
  supabase: SupabaseClient,
  playerId: string
): Promise<Map<string, ResolvableRepertoire> | null> {
  const { data, error } = await supabase.rpc('active_opening_sources', { p_player_id: playerId });
  if (error || !data) return null;

  type GatedRow = {
    opening_id: string;
    repertoire_id: string;
    eco_code: string | null;
    color: ResolvableRepertoire['color'];
    override_opening_id: string | null;
  };
  const rows = data as GatedRow[];

  return activeByOpening(
    rows.map((row) => ({
      id: row.repertoire_id,
      eco_code: row.eco_code,
      color: row.color,
      opening_id: row.override_opening_id
    })),
    rows.map((row) => ({ opening_id: row.opening_id, repertoire_id: row.repertoire_id }))
  );
}
