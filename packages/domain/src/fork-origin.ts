/**
 * A Fork's origin (#328; R-20, R-43, R-49, R-128, R-130): the source
 * Repertoire, the coach's one it was forked from, and the coach's display
 * name when the Fork was made. Every Fork records both: one the player asks
 * for, an accepted Fork offer, and the automatic Fork of a deleting coach.
 * The source becomes null once it is deleted; the name stays, as the
 * read-only coach notes keep it (R-47), so the player's list can still say
 * whose Assignment the Fork is of.
 */
export interface ForkOrigin {
  /** The source Repertoire; null once deleted, or unknown (R-131). */
  readonly repertoireId: string | null;
  /** The coach's display name when the Fork was made. */
  readonly coachName: string;
}

/** A repertoire's fork columns as stored: both null on a repertoire that is no Fork. */
interface ForkColumns {
  readonly repertoireId: string | null;
  readonly coachName: string | null;
}

/**
 * The origin a repertoire's columns record, or null: a repertoire that
 * recorded no coach is no Fork, or a Fork made before #328 whose origin
 * could not be derived, and shows no Fork label.
 */
export const forkOriginOf = ({
  repertoireId,
  coachName,
}: ForkColumns): ForkOrigin | null =>
  coachName === null ? null : { repertoireId, coachName };
