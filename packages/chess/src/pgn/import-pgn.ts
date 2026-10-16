/**
 * Lenient PGN import into a repertoire (R-64): every valid game becomes a
 * chapter of one position-keyed graph, and every game that cannot be used
 * is listed with its reason instead of refusing the file.
 *
 * Games are isolated before tokenizing, so text one game's tokenizer cannot
 * read costs only that game. The graph is built with mutable indexes and
 * frozen at the end, so hostile input stays linear (R-66), under the
 * builder's rules: one player answer per position across the repertoire,
 * and a move is stored once per position. Legality is the replay's.
 */
import { DEFAULT_POSITION, validateFen } from 'chess.js';
import { classify } from '../openings/classify';
import { positionKey, sideToMove } from '../position-key';
import {
  moveKey,
  type Arrow,
  type Chapter,
  type Circle,
  type RepertoireGraph,
  type RepertoireMove,
  type Side,
} from '../repertoire/graph';
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

/** A move while the graph is being built: mutable, with its mark identities. */
interface DraftMove {
  readonly from: string;
  readonly to: string;
  readonly san: string;
  readonly uci: string;
  readonly arrows: Arrow[];
  readonly circles: Circle[];
  readonly chapters: string[];
  readonly markKeys: Set<string>;
}

const draftOf = (move: ReplayedMove): DraftMove => ({
  from: move.from,
  to: move.to,
  san: move.san,
  uci: move.uci,
  arrows: [],
  circles: [],
  chapters: [],
  markKeys: new Set(),
});

/** Adds `values` the draft lacks, by their identity. */
function addMarks<T>(
  draft: DraftMove,
  target: T[],
  values: readonly T[],
  key: (value: T) => string,
): void {
  for (const value of values) {
    const id = key(value);
    if (!draft.markKeys.has(id)) {
      draft.markKeys.add(id);
      target.push(value);
    }
  }
}

/**
 * A repertoire being built game by game, with indexes by move and by
 * position, so each move costs about the same however large the file.
 */
class RepertoireBuilder {
  private readonly chapters: Chapter[] = [];
  private readonly moves = new Map<string, DraftMove>();
  private readonly children = new Map<string, DraftMove[]>();
  /** The player's answer in each position, by position key. */
  private readonly answers = new Map<string, string>();
  readonly skipped: Skipped[] = [];

  private readonly side: Side;

  constructor(side: Side) {
    this.side = side;
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
      if (this.leftOut(game.game, move, dropped)) dropped.add(index);
      else {
        this.put(move, chapter.id);
        kept += 1;
      }
    }
    if (kept > 0) this.chapters.push(chapter);
  }

  freeze(): RepertoireGraph {
    const moves: RepertoireMove[] = [...this.moves.values()].map(
      ({ from, to, san, uci, arrows, circles, chapters }) => ({
        from,
        to,
        san,
        uci,
        arrows,
        circles,
        chapters,
      }),
    );
    const chapters = this.chapters.map((c) => this.classified(c));
    return { side: this.side, chapters, moves };
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

  private isPlayerMove(from: string): boolean {
    return sideToMove(from) === (this.side === 'white' ? 'w' : 'b');
  }

  private leftOut(
    game: number,
    move: ReplayedMove,
    dropped: ReadonlySet<number>,
  ): boolean {
    if (move.parent !== null && dropped.has(move.parent)) return true;
    const answer = this.isPlayerMove(move.from)
      ? this.answers.get(move.from)
      : undefined;
    if (answer === undefined || answer === move.san) return false;
    const { san, moveNumber } = move;
    this.skipped.push({
      game,
      reason: 'pgn.secondAnswer',
      san,
      move: moveNumber,
    });
    return true;
  }

  private put(move: ReplayedMove, chapterId: string): void {
    const key = moveKey(move.from, move.san);
    let draft = this.moves.get(key);
    if (draft === undefined) {
      draft = draftOf(move);
      this.moves.set(key, draft);
      this.children.set(move.from, [
        ...(this.children.get(move.from) ?? []),
        draft,
      ]);
      if (this.isPlayerMove(move.from)) this.answers.set(move.from, move.san);
    }
    if (!draft.chapters.includes(chapterId)) draft.chapters.push(chapterId);
    addMarks(draft, draft.arrows, move.arrows, (a) => `a${arrowKey(a)}`);
    addMarks(draft, draft.circles, move.circles, (c) => `c${circleKey(c)}`);
  }

  /**
   * A chapter's main line as `mainLine` in the graph module defines it (the
   * first-inserted child at each position, never back to a position
   * already on the line), read from the builder's index in linear time.
   */
  private mainSans(chapter: Chapter): string[] {
    const sans: string[] = [];
    const seen = new Set([chapter.rootKey]);
    let key = chapter.rootKey;
    for (;;) {
      const next = this.children
        .get(key)
        ?.find((m) => m.chapters.includes(chapter.id) && !seen.has(m.to));
      if (next === undefined) return sans;
      sans.push(next.san);
      seen.add(next.to);
      key = next.to;
    }
  }

  /**
   * Names a chapter from the opening taxonomy when its main line, played
   * from the standard start, reaches an ECO position (R-63: taxonomy first).
   */
  private classified(chapter: Chapter): Chapter {
    if (chapter.rootKey !== START) return chapter;
    const entry = classify(this.mainSans(chapter));
    if (entry === null) return chapter;
    return { ...chapter, nameSource: { kind: 'eco', eco: entry.code } };
  }
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
