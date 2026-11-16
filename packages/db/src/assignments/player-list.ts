/**
 * The player's list of the repertoires they have by assignment, "From my
 * coach" (R-16, R-46, R-128, R-133, R-134), read through the shared
 * player-live reads in one repeatable-read snapshot.
 */
import type { Side } from '@mychess/chess';
import {
  assignmentBadges,
  byName,
  isUpdated,
  type BadgeSet,
  type ChangeStamp,
} from '@mychess/domain';
import { asc, desc, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { REPEATABLE_READ, type Executor } from '../client';
import { repertoireChanges } from '../assignment-schema';
import { namesOf } from './names';
import {
  trackedOf,
  loadLive,
  seenFacts,
  statusOf,
  type LiveAssignment,
} from './player-live';

/** One repertoire a player has from their coach, for "From my coach". */
export interface PlayerAssignment {
  readonly repertoireId: string;
  readonly name: string;
  readonly side: Side;
  readonly coachId: string;
  readonly coachName: string;
  /** effectiveDeadline: `YYYY-MM-DD` or null (R-16, R-134). */
  readonly deadline: string | null;
  readonly paused: boolean;
  /** Every player move tracked (R-129, R-181). */
  readonly done: boolean;
  /**
   * What the player sees on it at `now` (assignmentBadges): overdue
   * (R-51, R-132), paused (R-46) and "Updated", a coach change they have
   * not opened (R-133).
   */
  readonly badges: BadgeSet;
}

const latestRowsSchema = z.array(
  z.object({
    repertoireId: z.uuid(),
    version: z.number().int(),
    createdAt: z.date(),
  }),
);

/** Each repertoire's latest change for players: its version and time. */
async function latestChanges(
  db: Executor,
  ids: readonly string[],
): Promise<Map<string, ChangeStamp>> {
  if (ids.length === 0) return new Map();
  const rows = latestRowsSchema.parse(
    await db
      .selectDistinctOn([repertoireChanges.repertoireId], {
        repertoireId: repertoireChanges.repertoireId,
        version: repertoireChanges.version,
        createdAt: repertoireChanges.createdAt,
      })
      .from(repertoireChanges)
      .where(inArray(repertoireChanges.repertoireId, [...ids]))
      .orderBy(
        asc(repertoireChanges.repertoireId),
        desc(repertoireChanges.version),
      ),
  );
  return new Map(
    rows.map(({ repertoireId, ...stamp }) => [repertoireId, stamp]),
  );
}

interface ItemFacts extends LiveAssignment {
  readonly coachName: string;
  readonly latest: ChangeStamp | undefined;
  /** The player's tracked set (R-129, R-181). */
  readonly tracked: ReadonlySet<string>;
}

function itemOf(facts: ItemFacts, now: Date): PlayerAssignment {
  const { assignment, loaded } = facts;
  const { deadline, paused, done, overdue } = statusOf(
    facts,
    facts.tracked,
    now,
  );
  const updated = isUpdated(seenFacts(assignment), facts.latest);
  return {
    repertoireId: assignment.repertoireId,
    name: loaded.repertoire.name,
    side: loaded.repertoire.side,
    coachId: assignment.coachId,
    coachName: facts.coachName,
    deadline,
    paused,
    done,
    badges: assignmentBadges({ audience: 'player', overdue, paused, updated }),
  };
}

/**
 * The repertoires `playerId` has live from their coaches, one entry each,
 * by name (R-16: individual and group assignments merged; R-128: forked
 * ones left out).
 */
export function playerAssignments(
  db: Executor,
  playerId: string,
  now: Date,
): Promise<PlayerAssignment[]> {
  return db.transaction(async (tx) => {
    const live = await loadLive(tx, playerId);
    const names = await namesOf(
      tx,
      live.map(({ assignment }) => assignment.coachId),
    );
    const latest = await latestChanges(
      tx,
      live.map(({ assignment }) => assignment.repertoireId),
    );
    const tracked = await trackedOf(
      tx,
      playerId,
      live.map(({ loaded }) => loaded.graph),
    );
    return live
      .map((entry) =>
        itemOf(
          {
            ...entry,
            coachName: names.get(entry.assignment.coachId) ?? '',
            latest: latest.get(entry.assignment.repertoireId),
            tracked,
          },
          now,
        ),
      )
      .sort(byName((one) => ({ name: one.name, id: one.repertoireId })));
  }, REPEATABLE_READ);
}
