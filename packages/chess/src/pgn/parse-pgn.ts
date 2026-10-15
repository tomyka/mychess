/**
 * PGN import: untrusted PGN text to a position-keyed move graph (R-19).
 *
 * Ported from v1 (`archive/v1/mychess/src/lib/pgn/parser.ts` and the
 * naming in `pgn-import.ts`), with deliberate differences:
 * - Malformed input is refused as a whole, with a reason, instead of
 *   skipping bad moves and games silently. `parsePgn` stays strict: the
 *   owner's ruling to import the valid games and list the broken ones
 *   (R-64) belongs to the lenient importer, which parses game by game.
 * - A move keeps no colour or ply: both follow from its position key, and
 *   a position reached at different plies is one position.
 * - A game no header names gets `name: null`, not "Game N"; the UI
 *   supplies the fallback text.
 * - PGN comments and NAGs are kept on moves (v1 stripped them), and so are
 *   the `[%cal]` arrows and `[%csl]` circles comments draw (R-65). Other
 *   embedded commands, such as `[%clk]` clocks, are dropped.
 * - The comments before a game's first move are kept as its intro (R-66).
 */
import { DEFAULT_POSITION, validateFen } from 'chess.js';
import { positionKey } from '../position-key';
import type { Result } from '../result';
import { gameNames } from './game-names';
import {
  replay,
  type MoveOccurrence,
  type ReplayedMovetext,
  type ReplayRefusal,
} from './replay';
import { splitGames, type PgnHeaders, type RawGame } from './split-games';
import { tokenize, type UnreadablePgn } from './tokenize';

export type { PgnHeaders } from './split-games';

/**
 * One move of the graph: a SAN move between two position keys, with every
 * PGN comment, NAG, arrow and circle it carries anywhere in the file, and the games
 * (indexes into `PgnGraph.games`) that contain it.
 */
export interface PgnMove extends MoveOccurrence {
  games: number[];
}

/**
 * One game of the file that has moves (the importer maps games to
 * Chapters). `name` comes from its headers, or is null when no header
 * names it; `root` is its starting position key; `intro` is the prose
 * before its first move, or null.
 */
export interface PgnGame {
  name: string | null;
  headers: PgnHeaders;
  root: string;
  intro: string | null;
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

interface ReplayedGame extends ReplayedMovetext {
  headers: PgnHeaders;
  root: string;
}

function replayGame(
  game: RawGame,
  index: number,
): Result<ReplayedGame, PgnRefusal> {
  const fen = game.headers['FEN']?.trim() ?? DEFAULT_POSITION;
  if (!validateFen(fen).ok) {
    return { ok: false, refusal: { reason: 'pgn.invalidFen', game: index } };
  }
  const movetext = replay(fen, game.body);
  if (!movetext.ok) {
    return { ok: false, refusal: { ...movetext.refusal, game: index } };
  }
  return {
    ok: true,
    value: { headers: game.headers, root: positionKey(fen), ...movetext.value },
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

/** Appends the values `target` lacks; values are equal when their JSON is. */
function addAll<T>(target: T[], values: readonly T[]): void {
  const seen = new Set(target.map((value) => JSON.stringify(value)));
  for (const value of values) {
    const key = JSON.stringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      target.push(value);
    }
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
    arrows: [],
    circles: [],
    games: [],
  };
  addAll(move.pgnComments, occurrence.pgnComments);
  addAll(move.nags, occurrence.nags);
  addAll(move.arrows, occurrence.arrows);
  addAll(move.circles, occurrence.circles);
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
      intro: game.intro,
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
