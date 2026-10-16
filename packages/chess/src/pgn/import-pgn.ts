/**
 * Lenient PGN import into a repertoire (R-64): every valid game becomes a
 * chapter of one position-keyed graph, and every game that cannot be used
 * is listed with its reason instead of refusing the file.
 *
 * Games are isolated before tokenizing, so text one game's tokenizer cannot
 * read costs only that game. The moves go through the repertoire's mutable
 * move store (`RepertoireMoves`), so hostile input stays linear (R-66), under
 * the repertoire's rules: one player answer per position across the
 * repertoire, and a move is stored once per position. Legality is the
 * replay's.
 */
import { DEFAULT_POSITION, validateFen } from 'chess.js';
import { classify } from '../openings/classify';
import { positionKey } from '../position-key';
import type {
  Chapter,
  RepertoireGraph,
  RepertoireMove,
  Side,
} from '../repertoire/graph';
import { RepertoireMoves, type DraftMove } from '../repertoire/moves';
import { chapterWalks } from '../repertoire/walk';
import type { Result } from '../result';
import { gameNames } from './game-names';
import { checkLimits, PGN_LIMITS, type LimitRefusal } from './limits';
import { arrowKey, circleKey } from './marks';
import {
  replay,
  type ReplayedMove,
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
 * What an import left out, by the game's 1-based position among the file's
 * games: a whole game, with the move at fault when there is one, or a
 * second player answer (with its full-move number) and everything below it.
 */
export type Skipped =
  | {
      readonly game: number;
      readonly reason: 'pgn.secondAnswer';
      readonly san: string;
      readonly move: number;
    }
  | {
      readonly game: number;
      readonly reason: Exclude<SkipReason, 'pgn.secondAnswer'>;
      readonly san?: string;
    };

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

/**
 * The index just past a quoted tag value opened at `start`, or the end of
 * its line when nothing closes it there. A backslash escapes a character.
 */
function quoteEnd(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && text.charAt(i) !== '\n') {
    const ch = text.charAt(i);
    if (ch === '"') return i + 1;
    i += ch === '\\' && text.charAt(i + 1) !== '\n' ? 2 : 1;
  }
  return i;
}

function endOf(text: string, found: number): number {
  return found < 0 ? text.length : found;
}

/** The index after the character at `i`, or after the comment or quote it opens. */
function skip(text: string, i: number): number {
  switch (text.charAt(i)) {
    case '{':
      return endOf(text, text.indexOf('}', i + 1)) + 1;
    case ';':
      return endOf(text, text.indexOf('\n', i));
    case '"':
      return quoteEnd(text, i);
    default:
      return i + 1;
  }
}

/** The index of the newline that ends the line at `start`, comments spanning lines included. */
function lineEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length && text.charAt(i) !== '\n') i = skip(text, i);
  return Math.min(i, text.length);
}

function firstContent(text: string, start: number, end: number): number {
  let i = start;
  while (i < end && ' \t\r'.includes(text.charAt(i))) i += 1;
  return i;
}

/**
 * The file's text split where a game may start: at a line beginning with
 * `[` that follows movetext, outside a comment. A single pass, so hostile
 * text (an unclosed comment or quote) cannot make it slow.
 */
function chunks(text: string): string[] {
  const out: string[] = [];
  let chunkStart = 0;
  let movetext = false;
  for (let start = 0; start < text.length;) {
    const end = lineEnd(text, start);
    const content = firstContent(text, start, end);
    const tagLine = content < end && text.charAt(content) === '[';
    if (tagLine && movetext) {
      out.push(text.slice(chunkStart, start));
      chunkStart = start;
    }
    movetext = tagLine ? false : movetext || content < end;
    start = end + 1;
  }
  out.push(text.slice(chunkStart));
  return out;
}

/** The file's games; null stands for a chunk the tokenizer cannot read. */
function rawGames(text: string): (RawGame | null)[] {
  return chunks(text).flatMap((chunk) => {
    const tokens = tokenize(chunk);
    return tokens.ok ? splitGames(tokens.value) : [null];
  });
}

const skipGame = (skipped: Skipped): Replayed => ({
  ok: false,
  refusal: skipped,
});

function replayRaw(raw: RawGame | null, game: number): Replayed {
  if (raw === null) return skipGame({ game, reason: 'pgn.unreadable' });
  const fen = raw.headers['FEN']?.trim() ?? DEFAULT_POSITION;
  if (!validateFen(fen).ok) return skipGame({ game, reason: 'pgn.invalidFen' });
  const movetext = replay(fen, raw.body);
  if (!movetext.ok) return skipGame({ game, ...movetext.refusal });
  if (movetext.value.moves.length === 0) {
    return skipGame({ game, reason: 'pgn.noMoves' });
  }
  const value = { game, headers: raw.headers, root: positionKey(fen) };
  return { ok: true, value: { ...value, ...movetext.value } };
}

/** Adds the `values` a move lacks to `target`, by their identity in `seen`. */
function addMarks<T>(
  seen: Set<string>,
  target: T[],
  values: readonly T[],
  key: (value: T) => string,
): void {
  for (const value of values) {
    const id = key(value);
    if (!seen.has(id)) {
      seen.add(id);
      target.push(value);
    }
  }
}

/**
 * A repertoire being built game by game. Its moves go through the
 * repertoire's own store (one move per position, one answer per position),
 * which keeps each move about as cheap however large the file.
 */
class RepertoireBuilder {
  private readonly chapters: Chapter[] = [];
  private readonly moves: RepertoireMoves;
  /** Each stored move's mark identities, so marks merge without repeats. */
  private readonly markKeys = new Map<DraftMove, Set<string>>();
  readonly skipped: Skipped[] = [];

  readonly side: Side;

  constructor(side: Side) {
    this.side = side;
    this.moves = new RepertoireMoves(side);
  }

  /**
   * Adds a game as a chapter. A second player answer is reported and left
   * out, with every move below it in the game (followed by the replay's
   * parent links, so a transposition elsewhere cannot let them in). A game
   * none of whose moves fit adds no chapter.
   */
  addGame(game: GoodGame, name: string | null): void {
    const chapter = this.newChapter(game, name);
    const dropped = new Set<number>();
    let kept = 0;
    for (const [index, move] of game.moves.entries()) {
      if (this.put(game.game, move, chapter.id, dropped)) kept += 1;
      else dropped.add(index);
    }
    if (kept > 0) this.chapters.push(chapter);
  }

  freeze(): RepertoireGraph {
    const graph = {
      side: this.side,
      chapters: this.chapters,
      moves: this.moves.list(),
    };
    const walks = chapterWalks(graph);
    const chapters = this.chapters.map((c) =>
      classified(c, walks(c.id).mainLine()),
    );
    return { ...graph, chapters };
  }

  private newChapter(game: GoodGame, name: string | null): Chapter {
    const number = this.chapters.length + 1;
    return {
      id: `c${String(number)}`,
      rootKey: game.root,
      intro: game.intro,
      nameSource:
        name === null ? { kind: 'index', number } : { kind: 'header', name },
    };
  }

  /** Puts a move into the chapter; false when it is left out. */
  private put(
    game: number,
    move: ReplayedMove,
    chapterId: string,
    dropped: ReadonlySet<number>,
  ): boolean {
    if (move.parent !== null && dropped.has(move.parent)) return false;
    const put = this.moves.put(move, chapterId);
    if (!put.ok) {
      const { san, moveNumber } = move;
      this.skipped.push({
        game,
        reason: 'pgn.secondAnswer',
        san,
        move: moveNumber,
      });
      return false;
    }
    const seen = this.markKeys.get(put.value) ?? new Set<string>();
    this.markKeys.set(put.value, seen);
    addMarks(seen, put.value.arrows, move.arrows, (a) => `a${arrowKey(a)}`);
    addMarks(seen, put.value.circles, move.circles, (c) => `c${circleKey(c)}`);
    return true;
  }
}

/**
 * Names a chapter from the opening taxonomy when its main line, played
 * from the standard start, reaches an ECO position (R-63: taxonomy first).
 */
function classified(
  chapter: Chapter,
  mainLine: readonly RepertoireMove[],
): Chapter {
  if (chapter.rootKey !== START) return chapter;
  const entry = classify(mainLine.map((m) => m.san));
  if (entry === null) return chapter;
  return { ...chapter, nameSource: { kind: 'eco', eco: entry.code } };
}

const START = positionKey(DEFAULT_POSITION);

function build(side: Side, replayed: readonly Replayed[]): ImportedRepertoire {
  const good = replayed.flatMap((r) => (r.ok ? [r.value] : []));
  const names = gameNames(good.map((game) => game.headers));
  const builder = new RepertoireBuilder(side);
  let index = 0;
  for (const result of replayed) {
    if (result.ok) {
      builder.addGame(result.value, names[index] ?? null);
      index += 1;
    } else {
      builder.skipped.push(result.refusal);
    }
  }
  return { graph: builder.freeze(), skipped: builder.skipped };
}

/**
 * Imports untrusted PGN text as a repertoire for `side`: one chapter per
 * valid game, moves merged by position across chapters, with arrows,
 * circles and each chapter's intro kept. Games and moves that cannot be
 * used are listed in `skipped`; the file is refused only over the upload
 * limits or when no game is usable.
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
  const imported = build(
    side,
    games.map((raw, i) => replayRaw(raw, i + 1)),
  );
  if (imported.graph.chapters.length === 0) {
    return { ok: false, refusal: { reason: 'pgn.noValidGames' } };
  }
  return { ok: true, value: imported };
}
