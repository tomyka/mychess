/**
 * What an edit changes in a repertoire. `graphChanges` gives the rows an edit
 * changes (spec: "writes only the moves, chapters and comments that
 * changed"); `playerMoveChanges` and `netMoveChanges` give what it changes
 * for a player who trains the repertoire (R-121, R-133). A move is identified
 * by its move key; its `to` and `uci` follow from that key, so only its
 * comment and marks can change. A move's chapters are a set.
 */
import {
  isPlayerMove,
  moveKey,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
} from './graph';

/** One move in one chapter: a `move_chapters` row. */
export interface MoveLink {
  readonly moveKey: string;
  readonly chapterId: string;
}

export interface GraphChanges {
  readonly addedChapters: readonly Chapter[];
  readonly removedChapterIds: readonly string[];
  /** Kept chapters whose name or intro changed. */
  readonly changedChapters: readonly Chapter[];
  /** New moves; their links are their `chapters`. */
  readonly addedMoves: readonly RepertoireMove[];
  readonly removedMoveKeys: readonly string[];
  /**
   * Kept moves whose comment or marks changed: an annotation, never a change
   * to the moves a player trains (R-121).
   */
  readonly annotatedMoves: readonly RepertoireMove[];
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

function chapterChanges(before: RepertoireGraph, after: RepertoireGraph) {
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

function moveChanges(before: RepertoireGraph, after: RepertoireGraph) {
  const oldKeys = new Set(before.moves.map(keyOf));
  const newKeys = new Set(after.moves.map(keyOf));
  const kept = keptPairs(before, after);
  const stillThere = new Set(after.chapters.map((c) => c.id));
  return {
    addedMoves: after.moves.filter((m) => !oldKeys.has(keyOf(m))),
    removedMoveKeys: before.moves
      .filter((m) => !newKeys.has(keyOf(m)))
      .map(keyOf),
    annotatedMoves: kept
      .filter((p) => annotationOf(p.before) !== annotationOf(p.after))
      .map((p) => p.after),
    addedLinks: kept.flatMap((p) => linksBeyond(p.after, p.before, () => true)),
    removedLinks: kept.flatMap((p) =>
      linksBeyond(p.before, p.after, (c) => stillThere.has(c)),
    ),
  };
}

/** What turns `before` into `after`, as row changes. */
export function graphChanges(
  before: RepertoireGraph,
  after: RepertoireGraph,
): GraphChanges {
  return { ...chapterChanges(before, after), ...moveChanges(before, after) };
}

/**
 * Player moves an edit added or removed, each once per chapter it is in, and
 * how many moves' Comment or marks changed (R-121, R-133).
 */
export interface MoveChanges {
  readonly added: readonly MoveLink[];
  readonly removed: readonly MoveLink[];
  readonly commentsChanged: number;
}

/**
 * True when an edit changed nothing a player trains: no move added or
 * removed and no move's Comment or marks changed (a chapter rename alone).
 */
export const nothingChanged = (changes: MoveChanges): boolean =>
  changes.added.length + changes.removed.length + changes.commentsChanged === 0;

const playerLinks = (
  graph: RepertoireGraph,
  moves: readonly RepertoireMove[],
): MoveLink[] =>
  moves
    .filter((m) => isPlayerMove(graph, m))
    .flatMap((m) =>
      m.chapters.map((chapterId) => ({ moveKey: keyOf(m), chapterId })),
    );

/** What an edit from `before` to `after` changes for a player who trains it. */
export function playerMoveChanges(
  before: RepertoireGraph,
  after: RepertoireGraph,
): MoveChanges {
  const c = graphChanges(before, after);
  const removed = new Set(c.removedMoveKeys);
  return {
    added: playerLinks(after, c.addedMoves),
    removed: playerLinks(
      before,
      before.moves.filter((m) => removed.has(keyOf(m))),
    ),
    commentsChanged: c.annotatedMoves.length,
  };
}

type LinksByKey = Map<string, MoveLink[]>;

const byKey = (links: readonly MoveLink[]): LinksByKey => {
  const map: LinksByKey = new Map();
  for (const l of links) map.set(l.moveKey, [...(map.get(l.moveKey) ?? []), l]);
  return map;
};

/** Adds each move of `from` to `into`, unless `against` holds it: then both cancel. */
function fold(from: LinksByKey, into: LinksByKey, against: LinksByKey): void {
  for (const [key, links] of from) {
    if (against.has(key)) against.delete(key);
    else into.set(key, links);
  }
}

/**
 * The net of several edits in order: a move added then removed, or removed
 * then added back, is no change. The counts of changed comments add up.
 */
export function netMoveChanges(steps: readonly MoveChanges[]): MoveChanges {
  const added: LinksByKey = new Map();
  const removed: LinksByKey = new Map();
  let commentsChanged = 0;
  for (const step of steps) {
    fold(byKey(step.added), added, removed);
    fold(byKey(step.removed), removed, added);
    commentsChanged += step.commentsChanged;
  }
  return {
    added: [...added.values()].flat(),
    removed: [...removed.values()].flat(),
    commentsChanged,
  };
}
