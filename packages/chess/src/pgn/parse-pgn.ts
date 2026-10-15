import { validateFen } from 'chess.js';
import { positionKey } from '../position-key';
import type { Result } from '../result';
import { chapterNames } from './chapter-names';
import { replay, type MoveOccurrence, type ReplayRefusal } from './replay';
import { splitGames, type RawGame } from './split-games';
import { tokenize, type UnreadablePgn } from './tokenize';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * One move of the graph: from one position key to another by a SAN move,
 * with every comment and NAG it carries anywhere in the file, and the
 * chapters (indexes into `PgnGraph.chapters`) that contain it.
 */
export interface PgnMove {
  from: string;
  to: string;
  san: string;
  comments: string[];
  nags: number[];
  chapters: number[];
}

/**
 * One game of the file with moves. `name` comes from its headers, or is
 * null when no header names it; `root` is its starting position key.
 */
export interface PgnChapter {
  name: string | null;
  headers: Readonly<Record<string, string>>;
  root: string;
}

/** A PGN file as a position-keyed move graph, grouped into chapters. */
export interface PgnGraph {
  chapters: PgnChapter[];
  moves: PgnMove[];
}

/** Why a PGN file is refused; `game` indexes the games in the file. */
export type PgnRefusal =
  | UnreadablePgn
  | (ReplayRefusal & { game: number })
  | { reason: 'pgn.invalidFen'; game: number }
  | { reason: 'pgn.noMoves' };

interface ReplayedGame {
  headers: Readonly<Record<string, string>>;
  root: string;
  moves: MoveOccurrence[];
}

function replayGame(
  game: RawGame,
  index: number,
): Result<ReplayedGame, PgnRefusal> {
  const fen = game.headers['FEN']?.trim() ?? START_FEN;
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
  chapter: number,
): void {
  const id = `${occurrence.from}|${occurrence.san}`;
  const move = graph.get(id) ?? {
    from: occurrence.from,
    to: occurrence.to,
    san: occurrence.san,
    comments: [],
    nags: [],
    chapters: [],
  };
  addAll(move.comments, occurrence.comments);
  addAll(move.nags, occurrence.nags);
  addAll(move.chapters, [chapter]);
  graph.set(id, move);
}

function toGraph(games: readonly ReplayedGame[]): PgnGraph {
  const names = chapterNames(games.map((game) => game.headers));
  const moves = new Map<string, PgnMove>();
  for (const [chapter, game] of games.entries()) {
    for (const occurrence of game.moves) {
      mergeMove(moves, occurrence, chapter);
    }
  }
  return {
    chapters: games.map((game, i) => ({
      name: names[i] ?? null,
      headers: game.headers,
      root: game.root,
    })),
    moves: [...moves.values()],
  };
}

/**
 * Parses untrusted PGN text (one or more games, with variations, comments
 * and NAGs) into a position-keyed move graph: one chapter per game with
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
