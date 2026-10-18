// What adding a PGN to an existing repertoire comes to (R-101, R-115),
// decided from the repertoire before and after the merge. Pure, so the
// preview and the confirm decide it the same way.
import type { RepertoireGraph, Result } from '@mychess/chess';

/** What a merge adds to the repertoire it was merged into. */
export interface MergeAddition {
  readonly chapters: number;
  readonly moves: number;
  /** The first chapter it adds: the repertoire opens on it after the import. */
  readonly firstChapterId: string;
}

/** The merge adds nothing: every game of the file was refused against it. */
export interface NothingToAdd {
  readonly reason: 'pgn.nothingToAdd';
}

/**
 * What merging `before` into `after` adds. A merge adds an imported game
 * as a chapter only when it adds a new move (R-117), so a merge without a
 * new chapter adds nothing and is refused (R-115).
 */
export function mergeAddition(
  before: RepertoireGraph,
  after: RepertoireGraph,
): Result<MergeAddition, NothingToAdd> {
  const first = after.chapters[before.chapters.length];
  if (first === undefined)
    return { ok: false, refusal: { reason: 'pgn.nothingToAdd' } };
  return {
    ok: true,
    value: {
      chapters: after.chapters.length - before.chapters.length,
      moves: after.moves.length - before.moves.length,
      firstChapterId: first.id,
    },
  };
}
