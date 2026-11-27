/**
 * Where each player a coach's repertoire reaches stands on it, for the
 * coach's Repertoire screen (R-225, #385), inside repertoireAssignees'
 * snapshot (#395). The access step is coachRepertoireProgress's
 * (grantedReads), for every player at once, so whatever the progress page
 * withholds (unlinked, forked: Q26, R-155) is null here. A granted entry of
 * the coach's own repertoire reads through the coach's own scope, the one
 * the caller loaded the repertoire through, so its graph and the players'
 * Reviews are not read again. Internal to the package.
 */
import type { Standing, TrackedReview } from '@mychess/chess';
import { ownScope, scopeKey } from '@mychess/domain';
import type { CoachStatus } from '../assignments/status';
import type { Executor } from '../client';
import { grantedReads } from './granted';
import type { LoadedGraph } from './view';

/**
 * Where one assigned player stands: their standing, and their assignment's
 * deadline and status (R-129: done once every own move is tracked), the
 * status their row carries.
 */
export interface AssigneeStanding {
  readonly standing: Standing;
  readonly status: CoachStatus;
}

/** One reached player as the caller read them in its snapshot. */
export interface ReachedAssignee {
  readonly playerId: string;
  readonly status: CoachStatus;
  /** Their Reviews of the repertoire's player moves, by move key. */
  readonly tracked: ReadonlyMap<string, TrackedReview>;
}

/** The coach's own repertoire as the caller loaded it, and who it reaches. */
export interface StandingsRequest {
  readonly coachId: string;
  readonly loaded: LoadedGraph;
  readonly reached: readonly ReachedAssignee[];
}

/**
 * Each reached player's standing with their status, by player id; null
 * where the progress page shows the coach none. Statements: grantedReads'
 * only, fixed in the number of players; none for no players.
 */
export async function assigneeStandings(
  tx: Executor,
  { coachId, loaded, reached }: StandingsRequest,
  now: Date,
): Promise<Map<string, AssigneeStanding | null>> {
  const granted = await grantedReads(
    tx,
    coachId,
    loaded.repertoire.id,
    reached.map((one) => one.playerId),
  );
  const own = scopeKey(ownScope(coachId));
  const readOf = new Map(
    granted
      .filter(({ read }) => scopeKey(read.scope) === own)
      .map(({ playerId, read }) => [playerId, read]),
  );
  return new Map(
    reached.map((one) => {
      const read = readOf.get(one.playerId);
      const view = read?.coachView(loaded, one.tracked, now).view;
      return [
        one.playerId,
        view?.kind === 'granted'
          ? { standing: view.standing, status: one.status }
          : null,
      ];
    }),
  );
}
