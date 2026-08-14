import { parsePgn, type ParsedGame } from './pgn/parser';
import { detectOpening } from './openings/classify';
import { ECO_OPENINGS } from './openings/eco-data';

export type MoveRow = {
  fromFen: string;
  toFen: string;
  san: string;
  move_number: number;
  is_player_turn: boolean;
  annotation: string | null;
  // True when this move is a leaf WITHIN its own chapter's move set — see
  // chapterLeafFens. Used at write time (see `$lib/server/pgn-import.ts`) to
  // tag which moves close out a line for a given PGN chapter, so the
  // Practice picker can group variations by chapter later. Always false for
  // moves that don't come from a multi-chapter PGN import (e.g. the
  // chess.com/Lichess "my games" auto-import via `planGameImport`) — chapter
  // grouping doesn't apply there.
  isChapterEnd: boolean;
};

export type ImportChapter = {
  name: string;
  moves: MoveRow[];
  ecoCode: string | null;
  ecoName: string | null;
};

export type MultiImportPlan = ImportChapter[] | { error: string };

/** PGN's own placeholder for an unset header ("?") never counts as usable text. */
function usableHeader(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed !== '?' ? trimmed : null;
}

/**
 * The label for one game/chapter within a multi-game PGN: Event first (most
 * export tools put a real title there), falling back to White then Black
 * (some export tools — e.g. ChessBase reference/study files — put the
 * chapter title in one of those two instead, hardcoding the other to a
 * fixed placeholder — which one holds the title varies by export tool/
 * version, so both are tried), falling back to a plain ordinal when none of
 * the three holds anything ("1-indexed game N" — used for header-less
 * PGNs, or ones where White/Black are simply absent).
 */
export function chapterName(headers: Record<string, string>, index: number): string {
  return (
    usableHeader(headers.Event) ?? usableHeader(headers.White) ?? usableHeader(headers.Black) ?? `Game ${index + 1}`
  );
}

/**
 * Every `toFen` in `moves` that's never used as another move's `fromFen` —
 * i.e. every distinct line-ending position within one chapter's own moves,
 * including sidelines the chapter's own PGN branches into (not just its
 * mainline's final move). Used to tag which moves close out a chapter (see
 * `isChapterEnd` on `MoveRow`), so a variation ending on one of them can be
 * grouped under that chapter in the Practice picker.
 */
function chapterLeafFens(moves: { fromFen: string; toFen: string }[]): Set<string> {
  const fromFens = new Set(moves.map((m) => m.fromFen));
  return new Set(moves.map((m) => m.toFen).filter((fen) => !fromFens.has(fen)));
}

/**
 * Turns PGN text + a chosen studied color into one import chapter per game
 * in the file — each game's moves stay in their own chapter rather than
 * merging into a shared tree, since $lib/server/pgn-import.ts creates one
 * repertoire per chapter when a PGN contains more than one game. Imports
 * every move in each chapter, uncapped — which variations a player actually
 * practices is a separate, adjustable-after-the-fact choice (see
 * `variation_practice_exclusions`), not something decided once here at
 * import time. Pure — no I/O — so it's directly testable without touching
 * Supabase.
 */
export function planMultiImport(pgnText: string, color: 'white' | 'black'): MultiImportPlan {
  const games = parsePgn(pgnText);

  const chapters: ImportChapter[] = games.map((game, index) => {
    const rawMoves = game.moves.map((move) => ({
      fromFen: move.parentFen,
      toFen: move.fen,
      san: move.san,
      move_number: move.ply,
      is_player_turn: move.color === color,
      annotation: move.annotation ?? null
    }));
    const leafFens = chapterLeafFens(rawMoves);
    const moves: MoveRow[] = rawMoves.map((m) => ({ ...m, isChapterEnd: leafFens.has(m.toFen) }));
    const opening = detectOpening(game.moves.map((m) => m.san), ECO_OPENINGS);
    return {
      name: chapterName(game.headers, index),
      moves,
      ecoCode: opening?.code ?? null,
      ecoName: opening?.name ?? null
    };
  });

  if (chapters.length === 0) {
    return { error: 'No valid games found in PGN' };
  }

  return chapters;
}

/** Which side `username` played in a game, matched against the PGN's White/Black headers (case-insensitive). */
export function resolvePlayerColor(headers: Record<string, string>, username: string): 'white' | 'black' | null {
  const target = username.trim().toLowerCase();
  if (headers.White?.trim().toLowerCase() === target) return 'white';
  if (headers.Black?.trim().toLowerCase() === target) return 'black';
  return null;
}

export type GameImportPlan = {
  moves: MoveRow[];
  matchedGameCount: number;
  studiedColor: 'white' | 'black';
  ecoCode: string | null;
  ecoName: string | null;
};

/**
 * Like `planImport`, but for "my games" auto-import (chess.com/Lichess): the
 * player can be on either side from one game to the next, so the studied
 * color is resolved per game from its own White/Black headers instead of
 * being fixed for the whole import. Games where neither side matches
 * `username` are skipped. Returns null if no game matched.
 */
export function planGameImport(pgnText: string, username: string): GameImportPlan | null {
  const games = parsePgn(pgnText);

  const moves: MoveRow[] = [];
  let matchedGameCount = 0;
  let firstMatch: { game: ParsedGame; color: 'white' | 'black' } | null = null;

  for (const game of games) {
    const color = resolvePlayerColor(game.headers, username);
    if (!color) continue;
    matchedGameCount++;
    if (!firstMatch) firstMatch = { game, color };
    for (const move of game.moves) {
      moves.push({
        fromFen: move.parentFen,
        toFen: move.fen,
        san: move.san,
        move_number: move.ply,
        is_player_turn: move.color === color,
        annotation: move.annotation ?? null,
        isChapterEnd: false
      });
    }
  }

  if (!firstMatch) return null;

  const opening = detectOpening(firstMatch.game.moves.map((m) => m.san), ECO_OPENINGS);

  return {
    moves,
    matchedGameCount,
    studiedColor: firstMatch.color,
    ecoCode: opening?.code ?? null,
    ecoName: opening?.name ?? null
  };
}
