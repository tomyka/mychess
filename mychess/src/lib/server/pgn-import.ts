// mychess/src/lib/server/pgn-import.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { planImport } from '$lib/pgn-import';

export type ImportResult =
  | { repertoireId: string; gameCount: number; error: null }
  | { repertoireId: null; gameCount: null; error: string };

/** Creates a repertoire from PGN text and imports every move into its tree. */
export async function importPgn(
  supabase: SupabaseClient,
  params: { playerId: string; name: string; color: 'white' | 'black'; pgnText: string }
): Promise<ImportResult> {
  const plan = planImport(params.pgnText, params.color);
  if ('error' in plan) return { repertoireId: null, gameCount: null, error: plan.error };

  const { data: rep, error: repErr } = await supabase
    .from('repertoires')
    .insert({
      player_id: params.playerId,
      name: params.name,
      color: params.color,
      eco_code: plan.ecoCode,
      eco_name: plan.ecoName
    })
    .select()
    .single();
  if (repErr) return { repertoireId: null, gameCount: null, error: repErr.message };

  // Batch every write instead of doing 2 upserts + 2 selects + 1 upsert PER
  // MOVE (5 sequential round-trips each) — for a large multi-chapter study
  // that's easily thousands of round-trips, enough to blow past a request
  // timeout and leave a partially-imported repertoire behind. Chunking keeps
  // each request comfortably sized regardless of PGN size.
  const CHUNK = 500;
  const uniqueFens = Array.from(new Set(plan.moves.flatMap((m) => [m.fromFen, m.toFen])));

  // Any write failure below leaves an already-inserted repertoire row with
  // no (or partial) moves — silently swallowing that error is what produces
  // a repertoire that looks imported but is actually empty. Roll it back and
  // surface the real error instead.
  async function fail(message: string): Promise<ImportResult> {
    await supabase.from('repertoires').delete().eq('id', rep.id);
    return { repertoireId: null, gameCount: null, error: message };
  }

  // Reading the ids back afterward via `.select().in('fen', chunk)` used to
  // build a GET request with every FEN in this chunk crammed into the query
  // string — for a large repertoire that URL blows past a length limit
  // somewhere between here and Postgres and comes back as a bare "Bad
  // Request". Upserting with an (effectively no-op) update instead of
  // ignoreDuplicates makes Postgres's RETURNING include every touched row —
  // both newly-inserted and already-existing — so we get the ids straight
  // out of the same POST instead of a second, unbounded GET.
  const fenToId = new Map<string, string>();
  for (let i = 0; i < uniqueFens.length; i += CHUNK) {
    const chunk = uniqueFens.slice(i, i + CHUNK).map((fen) => ({ fen }));
    const { data: rows, error } = await supabase
      .from('positions')
      .upsert(chunk, { onConflict: 'fen' })
      .select('id, fen');
    if (error) return fail(`Failed to save positions: ${error.message}`);
    for (const row of rows ?? []) fenToId.set(row.fen, row.id);
  }

  const missingFens = uniqueFens.filter((fen) => !fenToId.has(fen));
  if (missingFens.length > 0) {
    return fail(`${missingFens.length} position(s) could not be saved — import aborted to avoid dropping moves silently.`);
  }

  // Multiple games can share an opening sequence (the same position and move
  // played twice) — upsert with ignoreDuplicates so they merge into one
  // shared edge in the tree instead of erroring on the second insert.
  const moveRows = plan.moves.map((move) => ({
    repertoire_id: rep.id,
    from_position: fenToId.get(move.fromFen)!,
    to_position: fenToId.get(move.toFen)!,
    san: move.san,
    move_number: move.move_number,
    is_player_turn: move.is_player_turn,
    annotation: move.annotation
  }));

  for (let i = 0; i < moveRows.length; i += CHUNK) {
    const chunk = moveRows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('moves')
      .upsert(chunk, { onConflict: 'repertoire_id,from_position,san', ignoreDuplicates: true });
    if (error) return fail(`Failed to save moves: ${error.message}`);
  }

  return { repertoireId: rep.id, gameCount: plan.gameCount, error: null };
}
