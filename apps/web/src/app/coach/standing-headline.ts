import {
  isUnstarted,
  percentLearned,
  type ProgressCounts,
} from '@mychess/chess';

/** The status flags a coach row can lead with, in the order they win. */
export const STATUS_FLAGS = ['overdue', 'paused', 'done'] as const;

export type StatusFlag = (typeof STATUS_FLAGS)[number];

/** An assignment's status flags, as a row's status or a player's summary. */
export type StatusFlags = Readonly<Record<StatusFlag, boolean>>;

/**
 * What a coach progress row leads with: a status flag, "Nothing to learn",
 * "Not started" with the moves, or the share learned with the counts.
 */
export type StandingHeadline =
  | { readonly kind: 'status'; readonly flag: StatusFlag }
  | { readonly kind: 'nothing' }
  | { readonly kind: 'notStarted'; readonly moves: number }
  | {
      readonly kind: 'counts';
      readonly percent: number;
      readonly counts: ProgressCounts;
    };

/**
 * Which word wins on a coach progress row (R-231, #381 sign-off): the
 * first status flag on (Overdue, Paused, Done), else "Nothing to learn"
 * for an empty repertoire, else "Not started" when nothing is started,
 * else the share learned. `status` is null where the row says its status
 * elsewhere, and the counts alone decide.
 */
export function standingHeadline(
  counts: ProgressCounts,
  status: StatusFlags | null,
): StandingHeadline {
  const flag = STATUS_FLAGS.find((on) => status?.[on] === true);
  if (flag !== undefined) return { kind: 'status', flag };
  const percent = percentLearned(counts);
  if (percent === null) return { kind: 'nothing' };
  if (isUnstarted(counts))
    return { kind: 'notStarted', moves: counts.notStarted };
  return { kind: 'counts', percent, counts };
}
