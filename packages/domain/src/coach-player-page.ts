/**
 * The repertoires on the coach's player page (spec, A player): which rows
 * become one card (a forked assignment and its shared fork, R-155) and the
 * order of the cards. Pure: the reads give each row's facts and status.
 */
import type { CoachRowStatus } from './coach-attention';
import { byNameAndId, type NameAndId } from './name-order';

/**
 * What a repertoire on the coach's player page is ordered by: its name and
 * id, and its assignment's status (null for a repertoire shared with the
 * coach).
 */
export type RepertoireUrgencyKey = NameAndId & {
  readonly status: CoachRowStatus | null;
};

/** The deadline that orders a repertoire: none for a share or an own copy (R-155). */
const orderingDeadline = (status: CoachRowStatus | null): string | null =>
  status === null || status.forked ? null : status.deadline;

/**
 * Overdue, then unfinished dated, then done dated, then undated
 * assignments (an own copy too), then shares.
 */
const urgencyRank = (status: CoachRowStatus | null): number => {
  if (status === null) return 4;
  if (orderingDeadline(status) === null) return 3;
  if (status.overdue) return 0;
  return status.done ? 2 : 1;
};

/** Soonest first; two in the same rank either both have a deadline or neither. */
const byDeadline = (a: string | null, b: string | null): number =>
  a === null || b === null ? 0 : a.localeCompare(b);

/**
 * The order of the repertoires on the coach's player page (spec, A
 * player; lead decision): overdue first, then by deadline soonest, the
 * done ones after the unfinished, then assignments without a deadline,
 * then the shared ones; each by name in the one name order (R-160). `key`
 * says where a card keeps its name, id and status.
 */
export const byRepertoireUrgency =
  <T>(key: (one: T) => RepertoireUrgencyKey) =>
  (a: T, b: T): number => {
    const x = key(a);
    const y = key(b);
    return (
      urgencyRank(x.status) - urgencyRank(y.status) ||
      byDeadline(orderingDeadline(x.status), orderingDeadline(y.status)) ||
      byNameAndId(x, y)
    );
  };

/** What ownCopyEntries reads of a repertoire on the coach's player page. */
export interface OwnCopyFacts {
  readonly id: string;
  /** Shared with the coach by the player (R-42). */
  readonly shared: boolean;
  /**
   * For a forked assignment, the player's fork when they share it with
   * this coach (R-155); null for a row that is not forked.
   */
  readonly forked: { readonly sharedForkId: string | null } | null;
}

/** A repertoire on the player page as it is, or an own copy with its shared fork. */
export type OwnCopyEntry<T> =
  | { readonly kind: 'row'; readonly row: T }
  | {
      readonly kind: 'ownCopy';
      readonly assignment: T;
      readonly sharedFork: T | null;
    };

/**
 * The player page's repertoires (spec, A player; R-155): a forked
 * assignment and the fork the player shares with the coach are one own
 * copy, the fork has no entry of its own; every other row stays as it is.
 * `facts` says what each row is.
 */
export function ownCopyEntries<T>(
  rows: readonly T[],
  facts: (row: T) => OwnCopyFacts,
): OwnCopyEntry<T>[] {
  const read = rows.map((row) => ({ row, ...facts(row) }));
  const shared = new Map(
    read.filter((one) => one.shared).map((one) => [one.id, one.row]),
  );
  const forkIds = new Set(
    read
      .map((one) => one.forked?.sharedForkId ?? null)
      .filter((id): id is string => id !== null),
  );
  const forkOf = (id: string | null): T | null =>
    id === null ? null : (shared.get(id) ?? null);
  return read.flatMap(({ row, id, forked, ...one }): OwnCopyEntry<T>[] => {
    if (forked !== null)
      return [
        {
          kind: 'ownCopy',
          assignment: row,
          sharedFork: forkOf(forked.sharedForkId),
        },
      ];
    return one.shared && forkIds.has(id) ? [] : [{ kind: 'row', row }];
  });
}
