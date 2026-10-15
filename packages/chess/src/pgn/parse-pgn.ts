/**
 * PGN import: untrusted PGN text to a position-keyed move graph (R-19).
 *
 * Ported from v1 (`archive/v1/mychess/src/lib/pgn/parser.ts` and the
 * naming in `pgn-import.ts`), with deliberate differences:
 * - Malformed input is refused as a whole, with a reason, instead of
 *   skipping bad moves and games silently (owner decision pending, #233
 *   q31b).
 * - A move keeps no colour or ply: both follow from its position key, and
 *   a position reached at different plies is one position.
 * - A game no header names gets `name: null`, not "Game N"; the UI
 *   supplies the fallback text.
 * - PGN comments and NAGs are kept on moves (v1 stripped them). Embedded
 *   commands such as `[%cal]` arrows are still dropped.
 */
import { DEFAULT_POSITION, validateFen } from 'chess.js';
import { positionKey } from '../position-key';
import type { Result } from '../result';
import { gameNames } from './game-names';
import { replay, type MoveOccurrence, type ReplayRefusal } from './replay';
import { splitGames, type PgnHeaders, type RawGame } from './split-games';
import { tokenize, type UnreadablePgn } from './tokenize';

export type { PgnHeaders } from './split-games';

/**
 * One move of the graph: a SAN move between two position keys, with every
 * PGN comment and NAG it carries anywhere in the file, and the games
 * (indexes into `PgnGraph.games`) that contain it.
 */
export interface PgnMove extends MoveOccurrence {
  games: number[];
}

/**
 * One game of the file that has moves (the importer maps games to
 * Chapters). `name` comes from its headers, or is null when no header
 * names it; `root` is its starting position key.
 */
export interface PgnGame {
  name: string | null;
  headers: PgnHeaders;
  root: string;
}

/** A PGN file as a position-keyed move graph, grouped by game. */
export interface PgnGraph {
  games: PgnGame[];
  moves: PgnMove[];
}

/**
 * Why a PGN file is refused. `game` is the 0-based position of the game in
 * the file, counting games without moves, which `PgnGraph.games` leaves out.
 */
export type PgnRefusal =
  | UnreadablePgn
  | (ReplayRefusal & { game: number })
  | { reason: 'pgn.invalidFen'; game: number }
  | { reason: 'pgn.noMoves' };

interface ReplayedGame {
  headers: PgnHeaders;
  root: string;
  moves: MoveOccurrence[];
}

function replayGame(
  game: RawGame,
  index: number,
): Result<ReplayedGame, PgnRefusal> {
  const fen = game.headers['FEN']?.trim() ?? DEFAULT_POSITION;
  if (!validateFen(fen).ok) {
    return { ok: false, refusal: { reason: 'pgn.invalidFen', game: index } };
  }
  const moves = replay(fen, game.body);
  if (!moves.ok) {
    return { ok: false, refusal: { ...moves.refusal, game: index } };
  }
  return {
    ok: true,
    value: {
      headers: game.headers,
      root: positionKey(fen),
      moves: moves.value,
    },
  };
}

function replayAll(
  games: readonly RawGame[],
): Result<ReplayedGame[], PgnRefusal> {
  const replayed: ReplayedGame[] = [];
  for (const [index, game] of games.entries()) {
    const result = replayGame(game, index);
    if (!result.ok) return result;
    if (result.value.moves.length > 0) replayed.push(result.value);
  }
  return { ok: true, value: replayed };
}

function addAll<T>(target: T[], values: readonly T[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

function mergeMove(
  graph: Map<string, PgnMove>,
  occurrence: MoveOccurrence,
  game: number,
): void {
  const { from, to, san } = occurrence;
  const id = `${from}|${san}`;
  const move = graph.get(id) ?? {
    from,
    to,
    san,
    pgnComments: [],
    nags: [],
    games: [],
  };
  addAll(move.pgnComments, occurrence.pgnComments);
  addAll(move.nags, occurrence.nags);
  addAll(move.games, [game]);
  graph.set(id, move);
}

function toGraph(replayed: readonly ReplayedGame[]): PgnGraph {
  const names = gameNames(replayed.map((game) => game.headers));
  const moves = new Map<string, PgnMove>();
  for (const [index, game] of replayed.entries()) {
    for (const occurrence of game.moves) {
      mergeMove(moves, occurrence, index);
    }
  }
  return {
    games: replayed.map((game, i) => ({
      name: names[i] ?? null,
      headers: game.headers,
      root: game.root,
    })),
    moves: [...moves.values()],
  };
}

/**
 * Parses untrusted PGN text (one or more games, with variations, comments
 * and NAGs) into a position-keyed move graph: one entry per game with
 * moves, and transpositions merged into one position, within and across
 * games. Malformed text is refused with a reason, never thrown.
 */
export function parsePgn(text: string): Result<PgnGraph, PgnRefusal> {
  const tokens = tokenize(text);
  if (!tokens.ok) return tokens;
  const games = replayAll(splitGames(tokens.value));
  if (!games.ok) return games;
  if (games.value.length === 0) {
    return { ok: false, refusal: { reason: 'pgn.noMoves' } };
  }
  return { ok: true, value: toGraph(games.value) };
}
