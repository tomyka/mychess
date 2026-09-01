// mychess/src/lib/server/pgn-import.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { planGameImport, type MoveRow } from '$lib/pgn-import';
import { enumerateVariations, hasChapterTags, type RawMoveRow } from '$lib/mastery/variations';
import { masterableChapters } from '$lib/mastery/repertoireStatus';
import { fetchAllMoves, toRawMoveRows } from './practice-repertoire';
import { fetchAllPages } from './paginate';

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
 * Creates one repertoire from a chapter's worth of moves (or appends to an
 * existing one, via `existingRepertoireId`), then chunk-upserts its
 * positions and moves into its tree. Public: called directly by
 * `/api/repertoires/import-chapter` so a multi-chapter PGN can be imported
 * chapter-by-chapter from the client with a real progress bar, while every
 * chapter's moves land in ONE shared repertoire (see the design doc linked
 * in the PR/issue) instead of each chapter becoming its own repertoire row.
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
    // Set when this call appends another chapter's moves onto a repertoire
    // an earlier call in the same multi-chapter import already created.
    existingRepertoireId?: string;
    // Defaults to true. Set to false for every non-final chapter of a
    // multi-chapter import — this call only sees ONE chapter's moves, so it
    // cannot correctly compute the repertoire's full shape yet. The FINAL
    // chapter of such an import passes `finalize: true` (or omits it —
    // that's the default) together with `existingRepertoireId`; in that
    // combination shape is computed from a FRESH FETCH of the repertoire's
    // full move set (not `params.moves`, which is still only this one
    // chapter's moves) so a correct, complete shape lands atomically with
    // the import's last write. Without this, a picker/dashboard load that
    // happens to land in the window between two chapters of the same import
    // could trigger `repertoire-progress.ts`'s lazy `backfillShapes` on an
    // incomplete move set — since that backfill only ever runs once per
    // repertoire, it would permanently cache the wrong shape.
    finalize?: boolean;
    // The originating PGN chapter's own bare title (e.g. `ImportChapter.name`
    // — "Ruy Lopez — Berlin Defense", NOT the combined "{repertoire name} —
    // {chapter title}" string `params.name` carries for a multi-chapter
    // import). Only ever sent for a multi-chapter import (see
    // `PgnImportForm.svelte`) — a single-chapter import has nothing to
    // group, so it's omitted and every move's `chapter_names` stays `[]`.
    // Written onto EVERY move this call writes (not just chapter-ending
    // leaves) — see the `moveRows` construction below.
    chapterLabel?: string;
  }
): Promise<{ repertoireId: string | null; error: string | null }> {
  let repId: string;
  let isNewRepertoire = false;

  if (params.existingRepertoireId) {
    repId = params.existingRepertoireId;
  } else {
    isNewRepertoire = true;
    const insertColumns: Record<string, unknown> = {
      player_id: params.playerId,
      name: params.name,
      color: params.color,
      eco_code: params.ecoCode,
      eco_name: params.ecoName
    };
    const computeShapeEagerly = params.finalize !== false;
    if (computeShapeEagerly) {
      // Computed from `params.moves` directly — before any DB writes — since
      // moves are immutable after import, this variation count never changes
      // again for this repertoire once it's known to be complete (a
      // single-chapter import, or `importGames`, which always hands over
      // every move up front).
      const dedupedMoves = Array.from(new Map(params.moves.map((m) => [`${m.fromFen}|${m.san}`, m])).values());
      const rawMoves: RawMoveRow[] = dedupedMoves.map((m, i) => ({
        id: String(i),
        fromPositionId: m.fromFen,
        toPositionId: m.toFen,
        fromFen: m.fromFen,
        toFen: m.toFen,
        san: m.san,
        isPlayerTurn: m.is_player_turn,
        chapterNames: []
      }));
      const variations = enumerateVariations(rawMoves);
      insertColumns.total_variations = variations.length;
      // `chapterNames` is hardcoded `[]` on `rawMoves` above (this path never
      // has real chapter tags to check — a single-chapter import, or
      // `importGames`'s "my games" auto-import), so this is always false
      // here. Written explicitly (not left null) so this repertoire never
      // needs the lazy has_chapters/chapter_count backfill in
      // `repertoire-progress.ts`.
      insertColumns.has_chapters = hasChapterTags(variations);
      insertColumns.chapter_count = masterableChapters(variations).length;
    }

    const { data: rep, error: repErr } = await supabase.from('repertoires').insert(insertColumns).select().single();
    if (repErr) return { repertoireId: null, error: repErr.message };
    repId = rep.id;
  }

  // Batch every write instead of doing 2 upserts + 2 selects + 1 upsert PER
  // MOVE (5 sequential round-trips each) — for a large multi-chapter study
  // that's easily thousands of round-trips, enough to blow past a request
  // timeout and leave a partially-imported repertoire behind. Chunking keeps
  // each request comfortably sized regardless of PGN size.
  const CHUNK = 500;
  // Same `max_rows` truncation concern as `fetchAllMoves` in
  // `practice-repertoire.ts` (PostgREST caps an unbounded select at 1000 rows
  // and truncates silently, no error) — the existing-rows lookup below can
  // easily need more than 1000 rows back for a heavy-transposition
  // repertoire (many chapters sharing the same handful of `from_position`s),
  // so it paginates the same way.
  const EXISTING_MOVES_PAGE_SIZE = 1000;
  const uniqueFens = Array.from(new Set(params.moves.flatMap((m) => [m.fromFen, m.toFen])));

  // Any write failure below leaves an already-inserted repertoire row with
  // no (or partial) moves — silently swallowing that error is what produces
  // a repertoire that looks imported but is actually empty. Roll back a
  // repertoire THIS call created; a pre-existing one (append mode) is left
  // alone — the client (see `PgnImportForm.svelte`) owns rolling back a
  // whole multi-chapter batch since it's the only party that knows every
  // chapter belongs to the same import.
  async function fail(message: string): Promise<{ repertoireId: string | null; error: string | null }> {
    if (isNewRepertoire) await supabase.from('repertoires').delete().eq('id', repId);
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

  // Multiple chapters can share an opening sequence (the same position and
  // move played twice) — every move in THIS call belongs to `chapterLabel`
  // (if given), whether it's a chapter-ending leaf or an interior move deep
  // in a shared prefix. Unlike the old leaf-only tagging, a shared edge that
  // multiple chapters use must know about ALL of them (not just whichever
  // chapter happened to write it first) — enumerateVariations scopes its
  // walk per chapter using this, and an edge invisible to a chapter's own
  // scope breaks that chapter's own path reconstruction. So conflicting
  // inserts merge chapter_names instead of being dropped (this call's own
  // chapter name gets added to whatever the row already has), which needs a
  // real upsert rather than `ignoreDuplicates: true`.
  // `import_order` is this move's own position in the PARSER's array — a
  // tie-break for moves sharing one `created_at` (a bulk upsert evaluates
  // `now()` once per statement, so every move in ONE writeMoves() call gets
  // an IDENTICAL timestamp; `fetchLiveMoves` used to fall back to `id`, a
  // random UUID, which silently scrambled a chapter's own move order —
  // verified against a real repertoire where a whole chapter's ~275 moves
  // shared one timestamp down to the microsecond). Only meaningful WITHIN
  // this call: `created_at` already separates different chapters/calls
  // correctly on its own, so this never needs to be globally unique.
  const moveRows = params.moves.map((move, index) => ({
    repertoire_id: repId,
    from_position: fenToId.get(move.fromFen)!,
    to_position: fenToId.get(move.toFen)!,
    san: move.san,
    move_number: move.move_number,
    is_player_turn: move.is_player_turn,
    annotation: move.annotation,
    chapter_names: params.chapterLabel ? [params.chapterLabel] : [],
    import_order: index
  }));

  // A single chapter's own move list shouldn't legitimately repeat the same
  // edge, but a real Postgres upsert (unlike the old `ignoreDuplicates: true`
  // / `ON CONFLICT DO NOTHING`) ERRORS if one statement tries to affect the
  // same conflict key twice ("ON CONFLICT DO UPDATE command cannot affect
  // row a second time") — `ignoreDuplicates` tolerated that silently, so
  // switching to a real upsert needs this dedupe to stay safe. Merges
  // chapter_names for any such within-call repeat rather than just keeping
  // one arbitrarily, and keeps the EARLIEST `import_order` of the two — the
  // first time this edge was seen is the one that should determine its
  // ordering, not whichever transposition happened to repeat it later.
  const dedupedMoveRows = Array.from(
    moveRows
      .reduce((map, row) => {
        const key = `${row.from_position}|${row.san}`;
        const existing = map.get(key);
        map.set(
          key,
          existing
            ? {
                ...row,
                chapter_names: Array.from(new Set([...existing.chapter_names, ...row.chapter_names])),
                import_order: Math.min(existing.import_order, row.import_order)
              }
            : row
        );
        return map;
      }, new Map<string, (typeof moveRows)[number]>())
      .values()
  );

  for (let i = 0; i < dedupedMoveRows.length; i += CHUNK) {
    const chunk = dedupedMoveRows.slice(i, i + CHUNK);

    // Look up which of this chunk's edges already exist (from an earlier
    // chapter in the same multi-chapter import sharing a prefix), so their
    // existing chapter_names can be merged rather than overwritten. Paginated
    // (see `EXISTING_MOVES_PAGE_SIZE` above) — a chunk can cover up to 500
    // distinct `from_position`s, and for a heavy-transposition repertoire the
    // matching row count can comfortably exceed PostgREST's 1000-row cap.
    const fromPositions = Array.from(new Set(chunk.map((m) => m.from_position)));

    // Unlike every other `fetchAllPages` caller, this one must NOT throw — a
    // failure here has to roll the half-written repertoire back via `fail`.
    // The count phase tags its own error so the catch can keep producing the
    // distinct "Failed to count existing moves" message it always has.
    type ExistingMoveRow = { from_position: string; san: string; chapter_names: string[] | null };
    let existingRows: ExistingMoveRow[];
    try {
      existingRows = await fetchAllPages<ExistingMoveRow>(
        () =>
          supabase
            .from('moves')
            .select('from_position, san, chapter_names')
            .eq('repertoire_id', repId)
            .in('from_position', fromPositions)
            .order('id', { ascending: true }),
        async () => {
          const result = await supabase
            .from('moves')
            .select('id', { count: 'exact', head: true })
            .eq('repertoire_id', repId)
            .in('from_position', fromPositions);
          if (result.error) throw Object.assign(new Error(result.error.message), { countPhase: true });
          return result;
        },
        EXISTING_MOVES_PAGE_SIZE
      );
    } catch (err) {
      const message = (err as { message?: string })?.message ?? String(err);
      return (err as { countPhase?: boolean })?.countPhase
        ? fail(`Failed to count existing moves: ${message}`)
        : fail(`Failed to load existing moves: ${message}`);
    }

    const existingByKey = new Map(
      existingRows.map((r) => [`${r.from_position}|${r.san}`, r.chapter_names ?? []])
    );
    const merged = chunk.map((m) => {
      const key = `${m.from_position}|${m.san}`;
      const existingNames = existingByKey.get(key) ?? [];
      return { ...m, chapter_names: Array.from(new Set([...existingNames, ...m.chapter_names])) };
    });

    const { error } = await supabase.from('moves').upsert(merged, { onConflict: 'repertoire_id,from_position,san' });
    if (error) return fail(`Failed to save moves: ${error.message}`);
  }

  // The LAST chapter of a multi-chapter import: `params.moves` above was
  // only THIS chapter's moves, not the repertoire's full accumulated set —
  // fetch everything now that every chapter's moves are committed, and
  // compute+write the real shape. See the `finalize` param's doc comment for
  // why this can't just reuse `params.moves` and why it can't be skipped in
  // favor of lazy backfill for this case.
  if (params.existingRepertoireId && params.finalize !== false) {
    const allMoves = await fetchAllMoves(supabase, repId);
    const rawMoves: RawMoveRow[] = toRawMoveRows(allMoves);
    const variations = enumerateVariations(rawMoves);
    const { error: shapeErr } = await supabase
      .from('repertoires')
      .update({
        total_variations: variations.length,
        has_chapters: hasChapterTags(variations),
        chapter_count: masterableChapters(variations).length
      })
      .eq('id', repId);
    // Non-fatal, mirroring `repertoire-progress.ts`'s own backfill error
    // handling: every move is already correctly committed at this point, so
    // a failure here just means the existing lazy backfill computes the
    // shape correctly the next time this repertoire loads, instead of it
    // landing immediately.
    if (shapeErr) console.error(`Failed to finalize shape for repertoire ${repId}:`, shapeErr);
  }

  return { repertoireId: repId, error: null };
}
