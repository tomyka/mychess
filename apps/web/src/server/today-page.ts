import 'server-only';
// Today's page (#381 part 2): the summary, the list's rows with each
// assignment's facts (R-222), the open fork offers, and the linked notice
// after accepting an invite (R-234).
import { playerCoaches } from '@mychess/db';
import type { Account } from '@mychess/domain';
import {
  todayAssignments,
  type AssignedFacts,
  type TodayAssigned,
  type TodayForkOffer,
} from './assignment-pages';
import { LINKED_PARAMS } from '../lib/routes';
import { getDb } from './db';
import {
  todayList,
  todaySummary,
  type TodayListRow,
  type TodaySummary,
} from './training';

/** One row of Today's list, with its assignment's facts. */
export interface TodayPageRow extends TodayListRow {
  /** An assignment's coach, deadline and badges; null for an own repertoire. */
  readonly assignment: AssignedFacts | null;
}

/** Whom an invite just accepted linked the player with (R-234). */
export interface LinkedFact {
  readonly coachName: string;
  /** The group the invite came through, when the player is in it. */
  readonly groupName: string | null;
}

export interface TodayPage {
  readonly displayName: string;
  readonly summary: TodaySummary;
  readonly rows: readonly TodayPageRow[];
  readonly offers: readonly TodayForkOffer[];
  /** The linked notice after accepting an invite, or null. */
  readonly linked: LinkedFact | null;
}

/** Today's search params: the ids accepting an invite lands with (R-234). */
export type TodayParams = Readonly<
  Partial<
    Record<
      (typeof LINKED_PARAMS)[keyof typeof LINKED_PARAMS],
      string | string[] | undefined
    >
  >
>;

/**
 * The linked notice's fact: the coach of `params.linked` among the
 * player's own coaches, and the group of `params.group` among the player's
 * groups of that coach. Names come from the links, never from the URL, so
 * a coach the player is not linked with names no one.
 */
async function linkedFact(
  playerId: string,
  params: TodayParams,
): Promise<LinkedFact | null> {
  const coachId = params[LINKED_PARAMS.coach];
  const groupId = params[LINKED_PARAMS.group];
  if (typeof coachId !== 'string') return null;
  const coaches = await playerCoaches(getDb(), playerId);
  const coach = coaches.find(({ id }) => id === coachId);
  if (coach === undefined) return null;
  const group = coach.groups.find(({ id }) => id === groupId);
  return { coachName: coach.displayName, groupName: group?.name ?? null };
}

/**
 * Each row with its assignment's facts, by repertoire id. An assigned row
 * whose facts are gone (the assignment ended between the two reads) is a
 * plain row; an own repertoire never has facts.
 */
export function pageRows(
  rows: readonly TodayListRow[],
  assigned: readonly TodayAssigned[],
): TodayPageRow[] {
  const facts = new Map(
    assigned.map(({ repertoireId, ...rest }) => [repertoireId, rest]),
  );
  return rows.map((row) => ({
    ...row,
    assignment:
      row.kind === 'assigned' ? (facts.get(row.repertoireId) ?? null) : null,
  }));
}

/**
 * The session account's Today page. The summary and the list share one
 * request-cached snapshot read; the assignments and the linked notice are
 * read for `account`, the session account the page already holds.
 */
export async function todayPage(
  account: Account,
  params: TodayParams,
): Promise<TodayPage> {
  const [summary, list, { assigned, offers }, linked] = await Promise.all([
    todaySummary(account),
    todayList(account),
    todayAssignments(account),
    linkedFact(account.id, params),
  ]);
  return {
    displayName: account.displayName,
    summary,
    rows: pageRows(list, assigned),
    offers,
    linked,
  };
}
