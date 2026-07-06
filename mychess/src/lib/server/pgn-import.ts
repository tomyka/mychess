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

  for (let i = 0; i < uniqueFens.length; i += CHUNK) {
    const chunk = uniqueFens.slice(i, i + CHUNK).map((fen) => ({ fen }));
    await supabase.from('positions').upsert(chunk, { onConflict: 'fen', ignoreDuplicates: true });
  }

  const fenToId = new Map<string, string>();
  for (let i = 0; i < uniqueFens.length; i += CHUNK) {
    const chunk = uniqueFens.slice(i, i + CHUNK);
    const { data: rows } = await supabase.from('positions').select('id, fen').in('fen', chunk);
    for (const row of rows ?? []) fenToId.set(row.fen, row.id);
  }

  // Multiple games can share an opening sequence (the same position and move
  // played twice) — upsert with ignoreDuplicates so they merge into one
  // shared edge in the tree instead of erroring on the second insert.
  const moveRows = plan.moves
    .map((move) => {
      const fromId = fenToId.get(move.fromFen);
      const toId = fenToId.get(move.toFen);
      if (!fromId || !toId) return null;
      return {
        repertoire_id: rep.id,
        from_position: fromId,
        to_position: toId,
        san: move.san,
        move_number: move.move_number,
        is_player_turn: move.is_player_turn,
        annotation: move.annotation
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  for (let i = 0; i < moveRows.length; i += CHUNK) {
    const chunk = moveRows.slice(i, i + CHUNK);
    await supabase.from('moves').upsert(chunk, { onConflict: 'repertoire_id,from_position,san', ignoreDuplicates: true });
  }

  return { repertoireId: rep.id, gameCount: plan.gameCount, error: null };
}
