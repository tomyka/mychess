/**
 * What a training question is about: a set of moves, a line or a chapter
 * (R-56, R-58), and the repertoires a player trains. Each resolves to the
 * review keys of its player moves, so no caller filters the opponent's moves
 * or builds a key by hand.
 */
import {
  isPlayerMove,
  moveKey,
  playerKeys,
  type RepertoireGraph,
  type RepertoireMove,
} from '../repertoire/graph';
import { chapterWalks } from '../repertoire/walk';

/** One of the player's repertoires, as training sees it. */
export interface TrainingRepertoire {
  readonly id: string;
  readonly graph: RepertoireGraph;
  /**
   * False when the repertoire is excluded from training: the player paused
   * their Assignment of it (R-46). It stays assigned but adds no Reviews and
   * no new moves; its moves still count as held, so their Reviews do not go
   * dormant.
   */
  readonly active: boolean;
}

/**
 * The moves a question covers: review keys as they are, one line of a chapter
 * (as `lines` returns it), or a whole chapter. A line or a chapter covers its
 * player moves only.
 */
export type Scope =
  | { readonly kind: 'moves'; readonly keys: readonly string[] }
  | {
      readonly kind: 'line';
      readonly graph: RepertoireGraph;
      readonly line: readonly RepertoireMove[];
    }
  | {
      readonly kind: 'chapter';
      readonly graph: RepertoireGraph;
      readonly chapterId: string;
    };

const keysOf = (
  graph: RepertoireGraph,
  moves: readonly RepertoireMove[],
): string[] => [
  ...new Set(
    moves
      .filter((m) => isPlayerMove(graph, m))
      .map((m) => moveKey(m.from, m.san)),
  ),
];

/** The review keys a scope covers, each once, in line order. */
export function scopeKeys(scope: Scope): string[] {
  switch (scope.kind) {
    case 'moves':
      return [...new Set(scope.keys)];
    case 'line':
      return keysOf(scope.graph, scope.line);
    case 'chapter':
      return keysOf(
        scope.graph,
        chapterWalks(scope.graph)(scope.chapterId).moves(),
      );
  }
}

/**
 * Every own move of the repertoires, paused ones included: any move of a
 * graph, so its Review stays out of dormancy (R-44, R-46). Not what training
 * offers: `heldMoves` (queue.ts) is the own moves a chapter walk of the
 * active repertoires reaches.
 */
export function repertoireKeys(
  repertoires: readonly TrainingRepertoire[],
): ReadonlySet<string> {
  return new Set(repertoires.flatMap((r) => playerKeys(r.graph)));
}
