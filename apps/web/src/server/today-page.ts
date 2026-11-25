import 'server-only';
// Today's page (#381 part 2): the summary's rows with each assignment's
// facts (R-222), and the open fork offers.
import type { Account } from '@mychess/domain';
import {
  homeAssignments,
  type AssignedListItem,
  type HomeForkOffer,
} from './assignment-pages';
import {
  todaySummary,
  type TodaySummary,
  type TodaySummaryRow,
} from './training';

/** One row of Today's list, with its assignment's facts. */
export interface TodayPageRow extends TodaySummaryRow {
  /** An assignment's coach, deadline and badges; null for an own repertoire. */
  readonly assignment: AssignedListItem | null;
}

export interface TodayPage {
  readonly displayName: string;
  readonly summary: TodaySummary;
  readonly rows: readonly TodayPageRow[];
  readonly offers: readonly HomeForkOffer[];
}

/**
 * Each row with its assignment's facts, by repertoire id. An assigned row
 * whose facts are gone (the assignment ended since the snapshot) is a plain
 * row; an own repertoire never has facts.
 */
export function joinFacts(
  rows: readonly TodaySummaryRow[],
  assigned: readonly AssignedListItem[],
): TodayPageRow[] {
  const byId = new Map(assigned.map((a) => [a.repertoireId, a]));
  return rows.map((row) => ({
    ...row,
    assignment: row.kind === 'assigned' ? (byId.get(row.id) ?? null) : null,
  }));
}

/** The session account's Today page. */
export async function todayPage(account: Account): Promise<TodayPage> {
  const [summary, { fromCoach, offers }] = await Promise.all([
    todaySummary(account),
    homeAssignments(),
  ]);
  return {
    displayName: account.displayName,
    summary,
    rows: joinFacts(summary.rows, fromCoach),
    offers,
  };
}
