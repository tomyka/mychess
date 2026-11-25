import 'server-only';
// Today's page (#381 part 2): the summary, the list's rows with each
// assignment's facts (R-222), and the open fork offers.
import type { Account } from '@mychess/domain';
import {
  todayAssignments,
  type AssignedListItem,
  type TodayForkOffer,
} from './assignment-pages';
import {
  todayList,
  todaySummary,
  type TodayListRow,
  type TodaySummary,
} from './training';

/** One row of Today's list, with its assignment's facts. */
export interface TodayPageRow extends TodayListRow {
  /** An assignment's coach, deadline and badges; null for an own repertoire. */
  readonly assignment: AssignedListItem | null;
}

export interface TodayPage {
  readonly displayName: string;
  readonly summary: TodaySummary;
  readonly rows: readonly TodayPageRow[];
  readonly offers: readonly TodayForkOffer[];
}

/**
 * Each row with its assignment's facts, by repertoire id. An assigned row
 * whose facts are gone (the assignment ended since the snapshot) is a plain
 * row; an own repertoire never has facts.
 */
export function joinFacts(
  rows: readonly TodayListRow[],
  assigned: readonly AssignedListItem[],
): TodayPageRow[] {
  const byId = new Map(assigned.map((a) => [a.repertoireId, a]));
  return rows.map((row) => ({
    ...row,
    assignment:
      row.kind === 'assigned' ? (byId.get(row.repertoireId) ?? null) : null,
  }));
}

/**
 * The session account's Today page. The summary and the list share one
 * request-cached snapshot read; the assignments are read for `account`, the
 * session account the page already holds.
 */
export async function todayPage(account: Account): Promise<TodayPage> {
  const [summary, list, { assigned, offers }] = await Promise.all([
    todaySummary(account),
    todayList(account),
    todayAssignments(account),
  ]);
  return {
    displayName: account.displayName,
    summary,
    rows: joinFacts(list, assigned),
    offers,
  };
}
