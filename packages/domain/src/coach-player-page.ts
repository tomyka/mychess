/**
 * The repertoires on the coach's player page (spec, A player): which Coach
 * views become one card (a forked assignment and its shared fork, R-155),
 * how each card is tagged (coachViewTag) and the order of the cards. Pure:
 * the read gives each repertoire's Coach view.
 */
import type { Standing } from '@mychess/chess';
import {
  coachViewTag,
  type CoachRowStatus,
  type CoachView,
  type CoachViewRepertoire,
  type CoachViewTag,
} from './coach-view';
import { byNameAndId } from './name-order';

/** One repertoire on the player page (R-231). */
export interface RepertoireCard {
  /** The repertoire it is named by: a forked assignment's own. */
  readonly repertoire: CoachViewRepertoire;
  readonly tag: CoachViewTag;
  /** The assignment's deadline and status; null for a shared repertoire. */
  readonly status: CoachRowStatus | null;
  /**
   * The standing the domain grants, and the repertoire it is of, where
   * Progress and Open go: for a forked assignment, its shared fork's; null
   * for a forked assignment whose fork is not shared (R-155).
   */
  readonly granted: {
    readonly id: string;
    readonly standing: Standing;
  } | null;
}

/** What the order reads of a card or a Coach view. */
type Urgent = Pick<CoachView, 'repertoire' | 'status'>;

/** The deadline that orders a repertoire: none for a share or a forked one (R-155). */
const orderingDeadline = (status: CoachRowStatus | null): string | null =>
  status === null || status.forked ? null : status.deadline;

/**
 * Overdue, then unfinished dated, then done dated, then undated
 * assignments (a forked one too), then shares.
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
 * then the shared ones; each by name in the one name order (R-160).
 */
const byRepertoireUrgency = (x: Urgent, y: Urgent): number =>
  urgencyRank(x.status) - urgencyRank(y.status) ||
  byDeadline(orderingDeadline(x.status), orderingDeadline(y.status)) ||
  byNameAndId(x.repertoire, y.repertoire);

/** A card's Coach view, and the view whose standing it shows, if any. */
interface Entry {
  readonly named: CoachView;
  readonly shows: CoachView | null;
}

/**
 * A forked assignment and the fork the player shares with the coach are
 * one entry, the fork has none of its own; every other view is its own
 * (spec, A player; R-155).
 */
function ownCopyEntries(views: readonly CoachView[]): Entry[] {
  const shared = new Map(
    views
      .filter((one) => one.source === 'shared')
      .map((one) => [one.repertoire.id, one]),
  );
  const forkOf = (one: CoachView): CoachView | null =>
    one.view.kind === 'forked' && one.view.sharedForkId !== null
      ? (shared.get(one.view.sharedForkId) ?? null)
      : null;
  const merged = new Set(views.flatMap((one) => forkOf(one) ?? []));
  return views.flatMap((one): Entry[] => {
    if (one.view.kind === 'forked') return [{ named: one, shows: forkOf(one) }];
    return merged.has(one) ? [] : [{ named: one, shows: one }];
  });
}

/** What a view grants: its standing and id, or nothing for a forked one. */
const grantedOf = (shows: CoachView | null): RepertoireCard['granted'] =>
  shows?.view.kind === 'granted'
    ? { id: shows.repertoire.id, standing: shows.view.standing }
    : null;

/**
 * The player page's cards, most urgent first: one per Coach view, a
 * forked assignment taking its shared fork's standing and links (the read
 * names the fork, #328) and that fork having no card of its own.
 */
export const playerPageCards = (
  views: readonly CoachView[],
): RepertoireCard[] =>
  ownCopyEntries(views)
    .map(({ named, shows }): RepertoireCard => ({
      repertoire: named.repertoire,
      tag: coachViewTag(named),
      status: named.status,
      granted: grantedOf(shows),
    }))
    .toSorted(byRepertoireUrgency);
