/**
 * The one query filter per RepertoireScope (#278): which `repertoires` rows
 * an account reaches as owner, as a coach a repertoire is shared with, or
 * as a player it is assigned to live. The domain decides (canUseScope,
 * canViewRepertoire, canCoachSee, canUseAssignment); every statement that
 * reads or writes a repertoire on someone's behalf filters through here
 * again, so no scope is spelled twice. Internal to the package.
 */
import {
  canUseScope,
  type RepertoirePurpose,
  type RepertoireScope,
} from '@mychess/domain';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { liveRepertoire } from '../assignments/reach';
import type { Executor } from '../client';
import { repertoireShares, repertoires } from '../schema';
import { sharedTo } from '../share-scope';

/** Matches no row: a purpose the scope does not allow (canUseScope). */
const NONE = sql`false`;

/** Only repertoire `id`, when one is named. */
const only = (id: string | undefined): SQL | undefined =>
  id === undefined ? undefined : eq(repertoires.id, id);

/** The ids of the player's repertoires shared with the coach, as a subquery. */
const sharedIdsOf = (
  db: Executor,
  scope: Extract<RepertoireScope, { kind: 'shared' }>,
  id: string | undefined,
) =>
  db
    .select({ id: repertoireShares.repertoireId })
    .from(repertoireShares)
    .where(
      and(
        sharedTo(scope.coachId, scope.playerId),
        id === undefined ? undefined : eq(repertoireShares.repertoireId, id),
      ),
    );

/**
 * The repertoires `scope` reaches for `purpose`, as a filter on
 * `repertoires`: of repertoire `id` alone when given. A purpose the scope
 * does not allow (editing through a share or an assignment) matches
 * nothing.
 */
export function repertoireScope(
  db: Executor,
  scope: RepertoireScope,
  purpose: RepertoirePurpose,
  id?: string,
): SQL | undefined {
  if (!canUseScope(scope, purpose).ok) return NONE;
  switch (scope.kind) {
    case 'own':
      return and(only(id), eq(repertoires.ownerAccountId, scope.ownerId));
    case 'shared':
      return and(only(id), inArray(repertoires.id, sharedIdsOf(db, scope, id)));
    case 'assigned':
      return liveRepertoire(db, scope.playerId, id);
  }
}
