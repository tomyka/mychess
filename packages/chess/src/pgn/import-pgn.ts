/**
 * Lenient PGN import into a repertoire (R-64): every valid game becomes a
 * chapter of one position-keyed graph, and every game that cannot be used
 * is listed with its reason instead of refusing the file.
 *
 * Games are isolated before tokenizing, so text one game's tokenizer cannot
 * read costs only that game. Moves go in through the builder's `addMove`,
 * so an import obeys the same rules as an edit: one player answer per
 * position, checked across the whole repertoire.
 */
import { DEFAULT_POSITION, validateFen } from 'chess.js';
import { classify } from '../openings/classify';
import { positionKey } from '../position-key';
import {
  mainLine,
  type Arrow,
  type Chapter,
  type Circle,
  type RepertoireGraph,
  type Side,
} from '../repertoire/graph';
import { addMove, setMarks } from '../repertoire/edit';
import type { Result } from '../result';
import { gameNames } from './game-names';
import { checkLimits, PGN_LIMITS, type LimitRefusal } from './limits';
import {
  replay,
  type MoveOccurrence,
  type ReplayedMovetext,
  type ReplayRefusal,
} from './replay';
import { splitGames, type PgnHeaders, type RawGame } from './split-games';
import { tokenize, type UnreadablePgn } from './tokenize';

/** Why a game of the file was left out; each reason is a message-catalogue key. */
export type SkipReason =
  | UnreadablePgn['reason']
  | ReplayRefusal['reason']
  | 'pgn.invalidFen'
  | 'pgn.noMoves'
  | 'pgn.secondAnswer';

/**
 * A game left out of the import: its 1-based position among the file's
 * games, why, and the move at fault when one is.
 */
export interface Skipped {
  readonly game: number;
  readonly reason: SkipReason;
  readonly san?: string;
}

/** Why a whole file is refused. */
export type ImportRefusal = LimitRefusal | { reason: 'pgn.noValidGames' };

export interface ImportedRepertoire {
  readonly graph: RepertoireGraph;
  readonly skipped: readonly Skipped[];
}

/** A game that replayed: what becomes a chapter. */
interface GoodGame extends ReplayedMovetext {
  game: number;
  headers: PgnHeaders;
  root: string;
}

type Replayed = Result<GoodGame, Skipped>;

/** Tag values, complete brace comments and rest-of-line comments. */
const CLOSED = /"(?:[^"\\]|\\.)*"|\{[^}]*\}|;.*/g;

/** Whether a brace comment is still open at the end of `line`. */
function commentOpenAfter(line: string, open: boolean): boolean {
  let rest = line;
  if (open) {
    const close = rest.indexOf('}');
    if (close < 0) return true;
    rest = rest.slice(close + 1);
  }
  return rest.replace(CLOSED, '').includes('{');
}

/**
 * The file's text split where a game may start: at a line beginning with
 * `[` that follows movetext, outside a brace comment.
 */
function chunks(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let movetext = false;
  let inComment = false;
  for (const line of text.split('\n')) {
    const tagLine = !inComment && line.trimStart().startsWith('[');
    if (tagLine && movetext) {
      out.push(current.join('\n'));
      current = [];
      movetext = false;
    }
    current.push(line);
    if (!tagLine && line.trim() !== '') movetext = true;
    inComment = commentOpenAfter(line, inComment);
  }
  out.push(current.join('\n'));
  return out;
}

/** The file's games; null stands for a chunk the tokenizer cannot read. */
function rawGames(text: string): (RawGame | null)[] {
  return chunks(text).flatMap((chunk) => {
    const tokens = tokenize(chunk);
    return tokens.ok ? splitGames(tokens.value) : [null];
  });
}

const skip = (skipped: Skipped): Replayed => ({ ok: false, refusal: skipped });

function replayRaw(raw: RawGame | null, game: number): Replayed {
  if (raw === null) return skip({ game, reason: 'pgn.unreadable' });
  const fen = raw.headers['FEN']?.trim() ?? DEFAULT_POSITION;
  if (!validateFen(fen).ok) return skip({ game, reason: 'pgn.invalidFen' });
  const movetext = replay(fen, raw.body);
  if (!movetext.ok) return skip({ game, ...movetext.refusal });
  if (movetext.value.moves.length === 0) {
    return skip({ game, reason: 'pgn.noMoves' });
  }
  const value = { game, headers: raw.headers, root: positionKey(fen) };
  return { ok: true, value: { ...value, ...movetext.value } };
}

/** `values` with `extra` appended, leaving out values already there. */
function union<T>(values: readonly T[], extra: readonly T[]): T[] {
  const seen = new Set(values.map((value) => JSON.stringify(value)));
  const out = [...values];
  for (const value of extra) {
    const key = JSON.stringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/** Adds an occurrence's arrows and circles to the move's own. */
function withMarks(
  graph: RepertoireGraph,
  chapterId: string,
  occurrence: MoveOccurrence,
): RepertoireGraph {
  const { arrows, circles } = occurrence;
  if (arrows.length === 0 && circles.length === 0) return graph;
  const move = graph.moves.find(
    (m) => m.from === occurrence.from && m.san === occurrence.san,
  );
  const marks: { arrows: Arrow[]; circles: Circle[] } = {
    arrows: union(move?.arrows ?? [], arrows),
    circles: union(move?.circles ?? [], circles),
  };
  const marked = setMarks(graph, chapterId, occurrence, marks);
  return marked.ok ? marked.value : graph;
}

/** A chapter being filled from one game, and what was skipped so far. */
interface Fill {
  graph: RepertoireGraph;
  readonly skipped: Skipped[];
}

/**
 * Adds one move of a game. A second player answer is reported and left out;
 * the moves below a left-out move then start from a position the chapter
 * does not reach, and `addMove` leaves them out too.
 */
function addOccurrence(
  fill: Fill,
  chapterId: string,
  game: number,
  occurrence: MoveOccurrence,
): void {
  const added = addMove(fill.graph, chapterId, occurrence.from, occurrence.san);
  if (added.ok) {
    fill.graph = withMarks(added.value, chapterId, occurrence);
  } else if (added.refusal.reason === 'repertoire.secondAnswer') {
    fill.skipped.push({
      game,
      reason: 'pgn.secondAnswer',
      san: occurrence.san,
    });
  }
}

function newChapter(
  graph: RepertoireGraph,
  game: GoodGame,
  name: string | null,
): Chapter {
  const number = graph.chapters.length + 1;
  return {
    id: `c${String(number)}`,
    rootKey: game.root,
    intro: game.intro,
    nameSource:
      name === null ? { kind: 'index', number } : { kind: 'header', name },
  };
}

/** Adds a game as a chapter; a game none of whose moves fit adds nothing. */
function addGame(fill: Fill, game: GoodGame, name: string | null): void {
  const before = fill.graph;
  const chapter = newChapter(before, game, name);
  fill.graph = { ...before, chapters: [...before.chapters, chapter] };
  for (const occurrence of game.moves) {
    addOccurrence(fill, chapter.id, game.game, occurrence);
  }
  if (!fill.graph.moves.some((m) => m.chapters.includes(chapter.id))) {
    fill.graph = before;
  }
}

const START = positionKey(DEFAULT_POSITION);

/**
 * Names a chapter from the opening taxonomy when its main line, played from
 * the standard start, reaches an ECO position (R-63: taxonomy first).
 */
function classified(graph: RepertoireGraph, chapter: Chapter): Chapter {
  if (chapter.rootKey !== START) return chapter;
  const entry = classify(mainLine(graph, chapter.id).map((m) => m.san));
  if (entry === null) return chapter;
  return { ...chapter, nameSource: { kind: 'eco', eco: entry.code } };
}

function build(side: Side, replayed: readonly Replayed[]): Fill {
  const good = replayed.flatMap((r) => (r.ok ? [r.value] : []));
  const names = gameNames(good.map((game) => game.headers));
  const fill: Fill = {
    graph: { side, chapters: [], moves: [] },
    skipped: [],
  };
  let index = 0;
  for (const result of replayed) {
    if (result.ok) {
      addGame(fill, result.value, names[index] ?? null);
      index += 1;
    } else {
      fill.skipped.push(result.refusal);
    }
  }
  const { graph } = fill;
  const chapters = graph.chapters.map((c) => classified(graph, c));
  return { ...fill, graph: { ...graph, chapters } };
}

/**
 * Imports untrusted PGN text as a repertoire for `side`: one chapter per
 * valid game, moves merged by position across chapters, with arrows,
 * circles and each chapter's intro kept. Games that cannot be used are
 * listed in `skipped`; the file is refused only over the upload limits or
 * when no game is usable.
 */
export function importPgn(
  text: string,
  side: Side,
): Result<ImportedRepertoire, ImportRefusal> {
  const limits = checkLimits(text);
  if (!limits.ok) return limits;
  const games = rawGames(text);
  if (games.length > PGN_LIMITS.games) {
    const limit = PGN_LIMITS.games;
    return { ok: false, refusal: { reason: 'pgn.tooManyGames', limit } };
  }
  const { graph, skipped } = build(
    side,
    games.map((raw, i) => replayRaw(raw, i + 1)),
  );
  if (graph.chapters.length === 0) {
    return { ok: false, refusal: { reason: 'pgn.noValidGames' } };
  }
  return { ok: true, value: { graph, skipped } };
}
