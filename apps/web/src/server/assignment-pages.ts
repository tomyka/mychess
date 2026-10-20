// The player's page of a repertoire they have by assignment (plan decisions
// 11 and 12). The page reads the database only through this loader, which
// starts from the session account: an id from the path never decides whose
// assignment is read.
import { assignedRepertoireForPlayer, changesSince } from '@mychess/db';
import type { MoveChanges, RepertoireGraph, Side } from '@mychess/chess';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ecoNamesOf } from './chapter-names';
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
  /** The names of the openings its chapters are named after. */
  readonly ecoNames: Readonly<Record<string, string>>;
  /** What changed since the player last opened it; empty when nothing did. */
  readonly changes: MoveChanges;
}

/**
 * Repertoire `rawId` as the session player has it by assignment. Not
 * assigned to them now, forked, missing or a malformed id: all 404 (plan
 * decision 12); the queries filter by the player again.
 */
export async function assignedRepertoireData(
  rawId: unknown,
): Promise<AssignedRepertoirePage> {
  const player = await requireOnboarded();
  const parsed = z.uuid().safeParse(rawId);
  if (!parsed.success) notFound();
  const db = getDb();
  const assigned =
    (await assignedRepertoireForPlayer(db, player.id, parsed.data)) ??
    notFound();
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
    ecoNames: ecoNamesOf(assigned.graph, player.locale),
    changes: since.changes,
  };
}
