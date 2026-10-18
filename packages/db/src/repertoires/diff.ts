/**
 * The rows an edit changes (spec: "writes only the moves, chapters and
 * comments that changed"). Pure, so it is tested without a database. A move
 * is identified by its move key; its `to` and `uci` follow from that key, so
 * only its comment and marks can change. A move's chapters are a set.
 */
import {
  moveKey,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';

/** One move in one chapter: a `move_chapters` row. */
export interface MoveLink {
  readonly moveKey: string;
  readonly chapterId: string;
}

export interface RepertoireDiff {
  readonly addedChapters: readonly Chapter[];
  readonly removedChapterIds: readonly string[];
  /** Kept chapters whose name or intro changed. */
  readonly changedChapters: readonly Chapter[];
  /** New moves; their links are their `chapters`. */
  readonly addedMoves: readonly RepertoireMove[];
  readonly removedMoveKeys: readonly string[];
  /** Kept moves whose comment or marks changed. */
  readonly changedMoves: readonly RepertoireMove[];
  /** Links added to kept moves. */
  readonly addedLinks: readonly MoveLink[];
  /** Links removed from kept moves of kept chapters (others go by cascade). */
  readonly removedLinks: readonly MoveLink[];
}

const keyOf = (m: RepertoireMove): string => moveKey(m.from, m.san);
const annotationOf = (m: RepertoireMove): string =>
  JSON.stringify([m.comment, m.arrows, m.circles]);
const faceOf = (c: Chapter): string => JSON.stringify([c.nameSource, c.intro]);

/** The links of `move` whose chapter `other` lacks and `keep` accepts. */
function linksBeyond(
  move: RepertoireMove,
  other: RepertoireMove,
  keep: (chapterId: string) => boolean,
): MoveLink[] {
  return move.chapters
    .filter((c) => !other.chapters.includes(c) && keep(c))
    .map((chapterId) => ({ moveKey: keyOf(move), chapterId }));
}

interface Pair {
  readonly before: RepertoireMove;
  readonly after: RepertoireMove;
}

function keptPairs(before: RepertoireGraph, after: RepertoireGraph): Pair[] {
  const old = new Map(before.moves.map((m) => [keyOf(m), m]));
  return after.moves.flatMap((m) => {
    const was = old.get(keyOf(m));
    return was === undefined ? [] : [{ before: was, after: m }];
  });
}

function chapterDiff(before: RepertoireGraph, after: RepertoireGraph) {
  const old = new Map(before.chapters.map((c) => [c.id, c]));
  const now = new Set(after.chapters.map((c) => c.id));
  return {
    addedChapters: after.chapters.filter((c) => !old.has(c.id)),
    removedChapterIds: before.chapters
      .filter((c) => !now.has(c.id))
      .map((c) => c.id),
    changedChapters: after.chapters.filter((c) => {
      const was = old.get(c.id);
      return was !== undefined && faceOf(was) !== faceOf(c);
    }),
  };
}

function moveDiff(before: RepertoireGraph, after: RepertoireGraph) {
  const oldKeys = new Set(before.moves.map(keyOf));
  const newKeys = new Set(after.moves.map(keyOf));
  const kept = keptPairs(before, after);
  const stillThere = new Set(after.chapters.map((c) => c.id));
  return {
    addedMoves: after.moves.filter((m) => !oldKeys.has(keyOf(m))),
    removedMoveKeys: before.moves
      .filter((m) => !newKeys.has(keyOf(m)))
      .map(keyOf),
    changedMoves: kept
      .filter((p) => annotationOf(p.before) !== annotationOf(p.after))
      .map((p) => p.after),
    addedLinks: kept.flatMap((p) => linksBeyond(p.after, p.before, () => true)),
    removedLinks: kept.flatMap((p) =>
      linksBeyond(p.before, p.after, (c) => stillThere.has(c)),
    ),
  };
}

/** What turns `before` into `after`, as row changes. */
export function diffRepertoire(
  before: RepertoireGraph,
  after: RepertoireGraph,
): RepertoireDiff {
  return { ...chapterDiff(before, after), ...moveDiff(before, after) };
}
