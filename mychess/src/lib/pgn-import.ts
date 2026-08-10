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
};

/**
 * Keeps only the prefix of each root-to-leaf line in `moves` up to
 * `maxPlayerMoves` of the studied color's own moves. A reference/theory PGN
 * can bury a full illustrative "model game" inside one otherwise-normal
 * variation, stretching a repertoire's level count to match that one
 * outlier line — this caps it at import time instead. A branch that
 * diverges *before* the cap is reached is kept intact even if a sibling
 * branch runs long; only the edge that would push a path over the cap, and
 * everything reachable only through it, is dropped.
 */
export function capVariationDepth(moves: MoveRow[], maxPlayerMoves: number): MoveRow[] {
  const byFromFen = new Map<string, MoveRow[]>();
  const toFens = new Set<string>();
  for (const m of moves) {
    const list = byFromFen.get(m.fromFen) ?? [];
    list.push(m);
    byFromFen.set(m.fromFen, list);
    toFens.add(m.toFen);
  }
  const fromFens = new Set(moves.map((m) => m.fromFen));
  const roots = Array.from(fromFens).filter((fen) => !toFens.has(fen));

  const kept = new Set<MoveRow>();
  function walk(fen: string, playerMoveCount: number) {
    for (const move of byFromFen.get(fen) ?? []) {
      const nextCount = playerMoveCount + (move.is_player_turn ? 1 : 0);
      if (nextCount > maxPlayerMoves) continue;
      kept.add(move);
      walk(move.toFen, nextCount);
    }
  }
  for (const root of roots) walk(root, 0);

  return moves.filter((m) => kept.has(m));
}

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
 * export tools put a real title there), falling back to White (some export
 * tools — e.g. ChessBase reference/study files — put the chapter title
 * there instead, with Black hardcoded to a fixed boilerplate value),
 * falling back to a plain ordinal when neither holds anything ("1-indexed
 * game N" — used for header-less PGNs, or ones where White/Black are
 * simply absent).
 */
export function chapterName(headers: Record<string, string>, index: number): string {
  return usableHeader(headers.Event) ?? usableHeader(headers.White) ?? `Game ${index + 1}`;
}

/**
 * Turns PGN text + a chosen studied color into one import chapter per game
 * in the file — each game's moves stay in their own chapter rather than
 * merging into a shared tree, since $lib/server/pgn-import.ts creates one
 * repertoire per chapter when a PGN contains more than one game. Each
 * chapter's lines are capped at `maxVariationMoves` of the studied color's
 * own moves (default 20 — see `capVariationDepth`). Pure — no I/O — so it's
 * directly testable without touching Supabase.
 */
export function planMultiImport(
  pgnText: string,
  color: 'white' | 'black',
  maxVariationMoves = 20
): MultiImportPlan {
  const games = parsePgn(pgnText);

  const chapters: ImportChapter[] = games.map((game, index) => {
    const moves: MoveRow[] = game.moves.map((move) => ({
      fromFen: move.parentFen,
      toFen: move.fen,
      san: move.san,
      move_number: move.ply,
      is_player_turn: move.color === color,
      annotation: move.annotation ?? null
    }));
    const opening = detectOpening(game.moves.map((m) => m.san), ECO_OPENINGS);
    return {
      name: chapterName(game.headers, index),
      moves: capVariationDepth(moves, maxVariationMoves),
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
        annotation: move.annotation ?? null
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
