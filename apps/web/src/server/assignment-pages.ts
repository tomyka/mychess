import 'server-only';
// What a player sees of their assignments: the page of a repertoire they
// have by assignment (plan decisions 11 and 12), and each assignment's facts
// and the fork offers on Today. The pages read the database only through these
// loaders, which start from the session account: an id from the path never
// decides whose assignment is read (Today's loader is handed the session
// account its page already read).
import {
  assignedRepertoireForPlayer,
  changesSince,
  openForkOffers,
  playerAssignments,
  type AssignedRepertoire,
  type OpenForkOffer,
  type PlayerAssignment,
} from '@mychess/db';
import type { MoveChanges } from '@mychess/chess';
import type { Account } from '@mychess/domain';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { z } from 'zod';
import { getDb } from './db';
import {
  versionedRepertoireForViewer,
  type VersionedRepertoireForViewer,
} from './repertoire-for-viewer';
import { requireOnboarded } from './session';

/**
 * An assigned repertoire as its player opens it (R-21, R-102, R-133): the
 * graph has the coach's comments, which the player sees as coach notes,
 * and its notes are the player's own Personal notes.
 */
export interface AssignedRepertoirePage extends VersionedRepertoireForViewer {
  /** Who assigned it: the repertoire's owner. */
  readonly coachName: string;
  readonly paused: boolean;
  /** The effective deadline, `YYYY-MM-DD`, or null (R-16, R-134). */
  readonly deadline: string | null;
  /** Decided by the domain's assignmentStatus as of the page load (R-51). */
  readonly overdue: boolean;
  /** What changed since the player last opened it; empty when nothing did. */
  readonly changes: MoveChanges;
}

/** The session player and what they have by assignment. */
interface AssignedRead {
  readonly player: Account;
  readonly assigned: AssignedRepertoire;
}

/**
 * Repertoire `rawId` as the session player has it by assignment. Not
 * assigned to them now, forked, missing or a malformed id: all 404 (plan
 * decision 12); the queries filter by the player again. Read once per
 * request: the layout decides with it before the page streams (#331), and
 * the page and its Repertoire screen read the same.
 */
export const viewedAssignedRepertoire = cache(
  async (rawId: unknown): Promise<AssignedRead> => {
    const player = await requireOnboarded();
    const parsed = z.uuid().safeParse(rawId);
    if (!parsed.success) notFound();
    const assigned =
      (await assignedRepertoireForPlayer(
        getDb(),
        player.id,
        parsed.data,
        new Date(),
      )) ?? notFound();
    return { player, assigned };
  },
);

/** The assigned page's repertoire, with what changed since the last visit. */
export async function assignedRepertoireData(
  rawId: unknown,
): Promise<AssignedRepertoirePage> {
  const { player, assigned } = await viewedAssignedRepertoire(rawId);
  const { id, version } = assigned.repertoire;
  // Up to the version read with the graph, so the summary matches what the
  // page shows; a later edit waits for the next visit. The layout already
  // decided access before the page streamed (#331): an assignment that
  // ended since shows no changes, not a 404 inside a 200.
  const since = await changesSince(getDb(), {
    playerId: player.id,
    repertoireId: id,
    upToVersion: version,
  });
  return {
    ...versionedRepertoireForViewer(assigned, assigned.personalNotes),
    coachName: assigned.coachName,
    paused: assigned.paused,
    deadline: assigned.deadline,
    overdue: assigned.overdue,
    changes: since?.changes ?? NO_CHANGES,
  };
}

/** What changed when nothing can be said to have. */
const NO_CHANGES: MoveChanges = { added: [], removed: [], commentsChanged: 0 };

/** What the Repertoire screen of an assigned repertoire shows (R-226). */
export interface AssignedManageData {
  readonly repertoire: { readonly id: string; readonly name: string };
  readonly paused: boolean;
}

/**
 * An assigned repertoire's Repertoire screen: its id, name and whether it
 * is paused, from the layout's read; nothing of what changed (404 as for
 * the page).
 */
export async function assignedManageData(
  rawId: unknown,
): Promise<AssignedManageData> {
  const { assigned } = await viewedAssignedRepertoire(rawId);
  const { id, name } = assigned.repertoire;
  return { repertoire: { id, name }, paused: assigned.paused };
}

/** An assignment under its side on My repertoires (#328). */
export type AssignedListItem = Pick<
  PlayerAssignment,
  | 'repertoireId'
  | 'name'
  | 'side'
  | 'chapters'
  | 'moves'
  | 'coachName'
  | 'deadline'
  | 'badges'
>;

/**
 * What an assignment adds to its repertoire wherever it is listed: who
 * assigned it, the deadline and the badges (R-51, R-46, R-133).
 */
export type AssignedFacts = Pick<
  PlayerAssignment,
  'coachName' | 'deadline' | 'badges'
>;

/** An assignment's facts by its repertoire, for its row on Today (R-222). */
export type TodayAssigned = AssignedFacts &
  Pick<PlayerAssignment, 'repertoireId'>;

/** One open fork offer on Today (R-44, R-130). */
export type TodayForkOffer = Pick<
  OpenForkOffer,
  'id' | 'name' | 'coachName' | 'daysLeft'
>;

export interface TodayAssignments {
  readonly assigned: readonly TodayAssigned[];
  readonly offers: readonly TodayForkOffer[];
}

/**
 * The session player's live assignments for My repertoires (#328),
 * individual and group merged (R-16), with their badges as Today shows
 * them; forked ones are left out (R-128).
 */
export async function myAssignedRepertoires(): Promise<AssignedListItem[]> {
  const player = await requireOnboarded();
  const mine = await playerAssignments(getDb(), player.id, new Date());
  return mine.map(
    ({
      repertoireId,
      name,
      side,
      chapters,
      moves,
      coachName,
      deadline,
      badges,
    }) => ({
      repertoireId,
      name,
      side,
      chapters,
      moves,
      coachName,
      deadline,
      badges,
    }),
  );
}

/**
 * `player`'s live assignments, with their badges decided by the domain
 * (assignmentStatus, assignmentBadges), and their open fork offers, both as
 * of now. An assignment carries only its facts: its row names it from the
 * training snapshot. `player` is the session account the page already
 * holds (Today reads it once), never an id from the request.
 */
export async function todayAssignments(
  player: Account,
): Promise<TodayAssignments> {
  const db = getDb();
  const now = new Date();
  const mine = await playerAssignments(db, player.id, now);
  const offers = await openForkOffers(db, player.id, now);
  return {
    assigned: mine.map(({ repertoireId, coachName, deadline, badges }) => ({
      repertoireId,
      coachName,
      deadline,
      badges,
    })),
    offers: offers.map(({ id, name, coachName, daysLeft }) => ({
      id,
      name,
      coachName,
      daysLeft,
    })),
  };
}
