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
    .insert({ player_id: params.playerId, name: params.name, color: params.color })
    .select()
    .single();
  if (repErr) return { repertoireId: null, gameCount: null, error: repErr.message };

  for (const move of plan.moves) {
    await supabase.from('positions').upsert({ fen: move.fromFen }, { onConflict: 'fen', ignoreDuplicates: true });
    await supabase.from('positions').upsert({ fen: move.toFen }, { onConflict: 'fen', ignoreDuplicates: true });

    const [{ data: fromPos }, { data: toPos }] = await Promise.all([
      supabase.from('positions').select('id').eq('fen', move.fromFen).single(),
      supabase.from('positions').select('id').eq('fen', move.toFen).single()
    ]);

    if (fromPos && toPos) {
      // Multiple games can share an opening sequence (the same position and
      // move played twice) — upsert with ignoreDuplicates so they merge into
      // one shared edge in the tree instead of erroring on the second insert.
      await supabase.from('moves').upsert(
        {
          repertoire_id: rep.id,
          from_position: fromPos.id,
          to_position: toPos.id,
          san: move.san,
          move_number: move.move_number,
          is_player_turn: move.is_player_turn,
          annotation: move.annotation
        },
        { onConflict: 'repertoire_id,from_position,san', ignoreDuplicates: true }
      );
    }
  }

  return { repertoireId: rep.id, gameCount: plan.gameCount, error: null };
}
