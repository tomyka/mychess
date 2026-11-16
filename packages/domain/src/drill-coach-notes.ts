/**
 * Which coach notes go with a move in training (#322, #338, R-174). On a
 * repertoire a coach assigned, the move's comment is the coach's one note
 * (R-102), named with that coach. On the player's own repertoire, the
 * comment is the player's and never shows; the notes are the one a fork
 * kept (R-43, R-49, R-141) first, then each sharing coach's (R-107). When
 * a drill shows them is the drill state's rule, not this one.
 */
import { moveKey, type RepertoireMove } from '@mychess/chess';

/** The repertoire a drilled move is of: assigned, with its coach, or the player's own. */
export type DrillRepertoire =
  | {
      readonly id: string;
      readonly kind: 'assigned';
      /** The assigning coach's display name. */
      readonly coachName: string;
    }
  | { readonly id: string; readonly kind: 'own' };

/** A coach's note on a move of the player's own repertoire. */
export interface OwnCoachNote {
  readonly repertoireId: string;
  readonly moveKey: string;
  readonly coachName: string;
  readonly text: string;
  /** Kept by the fork the repertoire is (R-43), or a sharing coach's (R-107). */
  readonly source: 'fork' | 'shared';
}

/** A coach note as a drill shows it, named with its coach. */
export interface DrillCoachNote {
  readonly coachName: string;
  readonly text: string;
}

const forkFirst = (a: OwnCoachNote, b: OwnCoachNote): number =>
  Number(a.source === 'shared') - Number(b.source === 'shared');

/**
 * The coach notes on `move` of `repertoire`. `ownNotes` are the notes on
 * the player's own repertoires, any of them; only this repertoire's on
 * this move count, and none on an assigned repertoire.
 */
export function drillCoachNotes(
  repertoire: DrillRepertoire,
  move: Pick<RepertoireMove, 'from' | 'san' | 'comment'>,
  ownNotes: readonly OwnCoachNote[],
): DrillCoachNote[] {
  if (repertoire.kind === 'assigned') {
    const text = move.comment?.trim() ?? '';
    return text === '' ? [] : [{ coachName: repertoire.coachName, text }];
  }
  const key = moveKey(move.from, move.san);
  return ownNotes
    .filter((n) => n.repertoireId === repertoire.id && n.moveKey === key)
    .toSorted(forkFirst)
    .map(({ coachName, text }) => ({ coachName, text }));
}
