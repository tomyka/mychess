import 'server-only';
// Today's page (#381 part 2): the summary, the list's rows built in one
// place from the training and each assignment's facts (R-222), and the open
// fork offers.
import type { TodayRow } from '@mychess/chess';
import type { Account } from '@mychess/domain';
import {
  todayAssignments,
  type AssignedFacts,
  type AssignedListItem,
  type TodayForkOffer,
} from './assignment-pages';
import {
  todaySummary,
  todayTraining,
  type TodayEntry,
  type TodaySummary,
  type TodayTraining,
} from './training';

/** One row of Today's list: the repertoire, its training and an assignment's facts. */
export interface TodayPageRow
  extends TodayRow, Pick<TodayEntry, 'name' | 'side' | 'kind'> {
  /** An assignment's coach, deadline and badges; null for an own repertoire. */
  readonly assignment: AssignedFacts | null;
}

export interface TodayPage {
  readonly displayName: string;
  readonly summary: TodaySummary;
  readonly rows: readonly TodayPageRow[];
  readonly offers: readonly TodayForkOffer[];
}

/** An assignment's facts without the name and side its row already has. */
const factsOf = ({
  coachName,
  deadline,
  badges,
}: AssignedListItem): AssignedFacts => ({ coachName, deadline, badges });

/**
 * Today's rows, in the training's order: each row with its entry's name,
 * side and kind and, for an assignment, its facts by repertoire id. An
 * assigned row whose facts are gone (the assignment ended between the two
 * reads) is a plain row; an own repertoire never has facts; a row without
 * an entry (the snapshot always has one) is left out.
 */
export function pageRows(
  training: TodayTraining,
  assigned: readonly AssignedListItem[],
): TodayPageRow[] {
  const entries = new Map(training.entries.map((e) => [e.id, e]));
  const facts = new Map(assigned.map((a) => [a.repertoireId, factsOf(a)]));
  return training.rows.flatMap((row) => {
    const entry = entries.get(row.repertoireId);
    if (entry === undefined) return [];
    const { name, side, kind } = entry;
    const assignment =
      kind === 'assigned' ? (facts.get(row.repertoireId) ?? null) : null;
    return [{ ...row, name, side, kind, assignment }];
  });
}

/**
 * The session account's Today page. The summary and the list share one
 * request-cached snapshot read; the assignments are read for `account`, the
 * session account the page already holds.
 */
export async function todayPage(account: Account): Promise<TodayPage> {
  const [summary, training, { assigned, offers }] = await Promise.all([
    todaySummary(account),
    todayTraining(account),
    todayAssignments(account),
  ]);
  return {
    displayName: account.displayName,
    summary,
    rows: pageRows(training, assigned),
    offers,
  };
}
