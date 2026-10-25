/**
 * R-54: the other answers the player's repertoires give in a position,
 * named so the panel can say where. R-147: the keys "Learn again" returns.
 */
import { isPlayerMove, type RepertoireGraph } from '../repertoire/graph';
import type { ReviewState } from './schedule';
import { scopeKeys, type Scope, type TrainingRepertoire } from './scope';
import { unreviewed } from './stored-review';

export interface OtherAnswer {
  readonly repertoireId: string;
  readonly san: string;
}

const answerIn = (
  graph: RepertoireGraph,
  fromKey: string,
): string | undefined =>
  graph.moves.find((m) => m.from === fromKey && isPlayerMove(graph, m))?.san;

/** Held repertoires (paused included) that play something other than `san` at `fromKey`. */
export function twoAnswers(
  fromKey: string,
  san: string,
  repertoires: readonly TrainingRepertoire[],
): OtherAnswer[] {
  return repertoires.flatMap((r) => {
    const other = answerIn(r.graph, fromKey);
    return other === undefined || other === san
      ? []
      : [{ repertoireId: r.id, san: other }];
  });
}

/** Keys of the scope that were skipped and never drilled (R-147), in line order. */
export function learnAgainKeys(
  scope: Scope,
  reviews: ReadonlyMap<string, ReviewState>,
  skipped: ReadonlySet<string>,
): string[] {
  return scopeKeys(scope).filter((key) => {
    const review = reviews.get(key);
    return skipped.has(key) && review !== undefined && unreviewed(review);
  });
}
