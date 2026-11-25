import 'server-only';
// What a player sees of their assignments: the page of a repertoire they
// have by assignment (plan decisions 11 and 12), and each assignment's facts
// and the fork offers on Today. The pages read the database only through these
// loaders, which start from the session account: an id from the path never
// decides whose assignment is read.
import {
  assignedRepertoireForPlayer,
  changesSince,
  openForkOffers,
  playerAssignments,
  type OpenForkOffer,
  type PlayerAssignment,
} from '@mychess/db';
import type { MoveChanges, RepertoireGraph, Side } from '@mychess/chess';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { z } from 'zod';
import type { ChapterNames } from '../lib/chapter-label';
import { chapterNamesOf } from './chapter-names';
import { getDb } from './db';
import { requireOnboarded } from './session';

/** An assigned repertoire as its player opens it (R-21, R-102, R-133). */
export interface AssignedRepertoirePage {
  readonly repertoire: {
    readonly id: string;
    readonly name: string;
    readonly side: Side;
    /** The version shown, which the page marks seen (R-133). */
    readonly version: number;
  };
  /** Who assigned it: the repertoire's owner. */
  readonly coachName: string;
  /** With the coach's comments, which the player sees as coach notes (R-102). */
  readonly graph: RepertoireGraph;
  /** The player's own notes on it, by move key (R-21). */
  readonly personalNotes: Readonly<Record<string, string>>;
  readonly paused: boolean;
  /** The effective deadline, `YYYY-MM-DD`, or null (R-16, R-134). */
  readonly deadline: string | null;
  /** Decided by the domain's assignmentStatus as of the page load (R-51). */
  readonly overdue: boolean;
  /** What titles its chapters: opening names and distinctions (R-158). */
  readonly names: ChapterNames;
  /** What changed since the player last opened it; empty when nothing did. */
  readonly changes: MoveChanges;
}

/**
 * Repertoire `rawId` as the session player has it by assignment. Not
 * assigned to them now, forked, missing or a malformed id: all 404 (plan
 * decision 12); the queries filter by the player again. Read once per
 * request: the page's layout decides with it before the page streams
 * (#331), and the page reads the same.
 */
export const assignedRepertoireData = cache(loadAssignedRepertoire);

async function loadAssignedRepertoire(
  rawId: unknown,
): Promise<AssignedRepertoirePage> {
  const player = await requireOnboarded();
  const parsed = z.uuid().safeParse(rawId);
  if (!parsed.success) notFound();
  const db = getDb();
  const assigned =
    (await assignedRepertoireForPlayer(
      db,
      player.id,
      parsed.data,
      new Date(),
    )) ?? notFound();
  const { id, name, side, version } = assigned.repertoire;
  // Up to the version read with the graph, so the summary matches what the
  // page shows; a later edit waits for the next visit.
  const since =
    (await changesSince(db, {
      playerId: player.id,
      repertoireId: id,
      upToVersion: version,
    })) ?? notFound();
  return {
    repertoire: { id, name, side, version },
    coachName: assigned.coachName,
    graph: assigned.graph,
    personalNotes: assigned.personalNotes,
    paused: assigned.paused,
    deadline: assigned.deadline,
    overdue: assigned.overdue,
    names: chapterNamesOf(assigned.graph),
    changes: since.changes,
  };
}

/**
 * One assignment's facts on its Today row (R-15, R-51, R-133, R-222) and
 * under its side on My repertoires (#328).
 */
export type AssignedListItem = Pick<
  PlayerAssignment,
  'repertoireId' | 'name' | 'side' | 'coachName' | 'deadline' | 'badges'
>;

/** One open fork offer on home (R-44, R-130). */
export type HomeForkOffer = Pick<
  OpenForkOffer,
  'id' | 'name' | 'coachName' | 'daysLeft'
>;

export interface HomeAssignments {
  readonly fromCoach: readonly AssignedListItem[];
  readonly offers: readonly HomeForkOffer[];
}

/** `playerId`'s live assignments as of `now`, individual and group merged (R-16). */
async function fromCoachOf(
  playerId: string,
  now: Date,
): Promise<AssignedListItem[]> {
  const mine = await playerAssignments(getDb(), playerId, now);
  return mine.map(
    ({ repertoireId, name, side, coachName, deadline, badges }) => ({
      repertoireId,
      name,
      side,
      coachName,
      deadline,
      badges,
    }),
  );
}

/**
 * The session player's live assignments for My repertoires (#328), with
 * their badges as home shows them; forked ones are left out (R-128).
 */
export async function myAssignedRepertoires(): Promise<AssignedListItem[]> {
  const player = await requireOnboarded();
  return fromCoachOf(player.id, new Date());
}

/**
 * The session player's live assignments, with their badges decided by the
 * domain (assignmentStatus, assignmentBadges), and their open fork offers,
 * both as of now.
 */
export async function homeAssignments(): Promise<HomeAssignments> {
  const player = await requireOnboarded();
  const db = getDb();
  const now = new Date();
  const fromCoach = await fromCoachOf(player.id, now);
  const offers = await openForkOffers(db, player.id, now);
  return {
    fromCoach,
    offers: offers.map(({ id, name, coachName, daysLeft }) => ({
      id,
      name,
      coachName,
      daysLeft,
    })),
  };
}
