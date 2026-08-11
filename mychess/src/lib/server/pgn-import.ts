// mychess/src/lib/server/pgn-import.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { planGameImport, type MoveRow } from '$lib/pgn-import';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { repertoireShape } from '$lib/mastery/levelProgress';

export type GameImportResult = { repertoireId: string | null; gameCount: number; error: string | null };

/**
 * Splits values into batches whose combined length stays under `maxChars`.
 * Used to keep a `.in('col', batch)` filter's URL-encoded query string under
 * a safe length — a fixed row count alone isn't enough, since it doesn't
 * account for how long the individual values (FENs) happen to be.
 */
function chunkByLength(values: string[], maxChars: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const value of values) {
    if (current.length > 0 && length + value.length + 1 > maxChars) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(value);
    length += value.length + 1;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Imports "my games" from chess.com/Lichess: the player's studied color is
 * resolved per game (see `planGameImport`) rather than fixed up front.
 * Returns `{ gameCount: 0, error: null }` when no game matched `username` —
 * that's a no-op, not a failure.
 */
export async function importGames(
  supabase: SupabaseClient,
  params: { playerId: string; username: string; name: string; pgnText: string }
): Promise<GameImportResult> {
  const plan = planGameImport(params.pgnText, params.username);
  if (!plan) return { repertoireId: null, gameCount: 0, error: null };

  const result = await writeMoves(supabase, {
    playerId: params.playerId,
    name: params.name,
    color: plan.studiedColor,
    ecoCode: plan.ecoCode,
    ecoName: plan.ecoName,
    moves: plan.moves
  });
  if (result.error) return { repertoireId: null, gameCount: 0, error: result.error };
  return { repertoireId: result.repertoireId as string, gameCount: plan.matchedGameCount, error: null };
}

/**
 * Creates one repertoire from a single chapter's worth of moves, then
 * chunk-upserts its positions and moves into its tree. Public: called
 * directly by `/api/repertoires/import-chapter` so a multi-chapter PGN can
 * be imported chapter-by-chapter from the client with a real progress bar,
 * instead of one request doing every chapter before replying.
 */
export async function writeMoves(
  supabase: SupabaseClient,
  params: {
    playerId: string;
    name: string;
    color: 'white' | 'black';
    ecoCode: string | null;
    ecoName: string | null;
    moves: MoveRow[];
  }
): Promise<{ repertoireId: string | null; error: string | null }> {
  // Computed from `params.moves` directly — before any DB writes — since
  // moves are immutable after import, this "shape" (see
  // `$lib/mastery/levelProgress.ts`) never changes again for this
  // repertoire. Caching it here lets loadRepertoireProgressSummaries (the
  // Dashboard + Practice picker) skip re-fetching and re-walking every move
  // on every load. Deduped by (fromFen, san) first, mirroring the moves
  // upsert's own conflict target below — `importGames` can hand this
  // several real games sharing an opening, whose shared edges collapse into
  // one on write, and the cached shape has to match what's actually stored.
  const dedupedMoves = Array.from(new Map(params.moves.map((m) => [`${m.fromFen}|${m.san}`, m])).values());
  const rawMoves: RawMoveRow[] = dedupedMoves.map((m, i) => ({
    id: String(i),
    fromPositionId: m.fromFen,
    toPositionId: m.toFen,
    fromFen: m.fromFen,
    toFen: m.toFen,
    san: m.san,
    isPlayerTurn: m.is_player_turn
  }));
  const shape = repertoireShape(enumerateVariations(rawMoves));

  const { data: rep, error: repErr } = await supabase
    .from('repertoires')
    .insert({
      player_id: params.playerId,
      name: params.name,
      color: params.color,
      eco_code: params.ecoCode,
      eco_name: params.ecoName,
      total_variations: shape.totalVariations,
      total_levels: shape.totalLevels,
      level1_task_count: shape.level1TaskCount
    })
    .select()
    .single();
  if (repErr) return { repertoireId: null, error: repErr.message };

  // Batch every write instead of doing 2 upserts + 2 selects + 1 upsert PER
  // MOVE (5 sequential round-trips each) — for a large multi-chapter study
  // that's easily thousands of round-trips, enough to blow past a request
  // timeout and leave a partially-imported repertoire behind. Chunking keeps
  // each request comfortably sized regardless of PGN size.
  const CHUNK = 500;
  const uniqueFens = Array.from(new Set(params.moves.flatMap((m) => [m.fromFen, m.toFen])));

  // Any write failure below leaves an already-inserted repertoire row with
  // no (or partial) moves — silently swallowing that error is what produces
  // a repertoire that looks imported but is actually empty. Roll it back and
  // surface the real error instead.
  async function fail(message: string): Promise<{ repertoireId: string | null; error: string | null }> {
    await supabase.from('repertoires').delete().eq('id', rep.id);
    return { repertoireId: null, error: message };
  }

  for (let i = 0; i < uniqueFens.length; i += CHUNK) {
    const chunk = uniqueFens.slice(i, i + CHUNK).map((fen) => ({ fen }));
    const { error } = await supabase.from('positions').upsert(chunk, { onConflict: 'fen', ignoreDuplicates: true });
    if (error) return fail(`Failed to save positions: ${error.message}`);
  }

  // `positions` only has INSERT/SELECT RLS policies (no UPDATE), so the id
  // lookup has to be a plain SELECT rather than an upsert-with-return. A GET
  // with every FEN in this chunk crammed into the query string can blow past
  // a proxy's URL-length limit — chunk by character budget, not row count,
  // since a fixed row count doesn't account for how long individual FENs are.
  // 6000 stays comfortably under typical proxy limits (~8KB) while cutting
  // round-trips ~4x vs. the previous 1500 budget — a large multi-chapter
  // import (thousands of unique positions) was serializing hundreds of tiny
  // sequential SELECTs here, the dominant cost in a slow import.
  const fenToId = new Map<string, string>();
  for (const chunk of chunkByLength(uniqueFens, 6000)) {
    const { data: rows, error } = await supabase.from('positions').select('id, fen').in('fen', chunk);
    if (error) return fail(`Failed to load positions: ${error.message}`);
    for (const row of rows ?? []) fenToId.set(row.fen, row.id);
  }

  const missingFens = uniqueFens.filter((fen) => !fenToId.has(fen));
  if (missingFens.length > 0) {
    return fail(`${missingFens.length} position(s) could not be saved — import aborted to avoid dropping moves silently.`);
  }

  // Multiple games can share an opening sequence (the same position and move
  // played twice) — upsert with ignoreDuplicates so they merge into one
  // shared edge in the tree instead of erroring on the second insert.
  const moveRows = params.moves.map((move) => ({
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

  return { repertoireId: rep.id, error: null };
}
