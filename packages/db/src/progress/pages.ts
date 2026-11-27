/**
 * The coach pages composed from one snapshot each (#303): the home's
 * players with when they last trained, and the group page (the group, who
 * could join it, and its grid). Like the progress reads in
 * coach-progress.ts, each takes the pool (`Db`), never a caller's
 * transaction, and the domain decides inside the snapshot (lastTrained,
 * groupGrid).
 */
import type { RepertoireGraph } from '@mychess/chess';
import {
  NO_DEADLINES,
  deadlineAssignments,
  ownScope,
  playerDeadlines,
  type AccountRef,
  type CoachProgressFacts,
  type PlayerDeadlines,
} from '@mychess/domain';
import { REPEATABLE_READ, type Db, type Executor } from '../client';
import { trackedReviews } from '../training/reviews';
import { keysOf, loadAllVisible } from './view';
import { coachPlayers, type LinkedAccount } from '../coaching';
import { coachGroup, type CoachGroup } from '../groups';
import { openGroupInvite, type OpenGroupInvite } from '../invites';
import { groupGrid, type GroupProgress } from './coach-progress';
import { coachProgressFacts, lastTrained } from './facts';

/** The coach's linked players not in `group`, by display name. */
async function addableTo(
  tx: Executor,
  coachId: string,
  group: CoachGroup,
): Promise<AccountRef[]> {
  const members = new Set(group.members.map((member) => member.id));
  return (await coachPlayers(tx, coachId))
    .filter((player) => !members.has(player.id))
    .map(({ id, displayName }) => ({ id, displayName }));
}

/** The group page: the group, who could join it, and its grid. */
export interface GroupPage {
  /** The coach's own group, its members by name. */
  readonly group: CoachGroup;
  /** The coach's linked players not yet in the group, by display name. */
  readonly addable: readonly AccountRef[];
  readonly grid: GroupProgress;
  /** The group's newest open invite (R-232); null for none. */
  readonly invite: OpenGroupInvite | null;
}

/**
 * The group page, its one read: the coach's own group with its members,
 * the coach's linked players not in it, the grid (R-153): one column
 * per repertoire assigned to it (by name), one row per member (by name),
 * and its open invite (R-232).
 * Undefined for any other group.
 */
export function coachGroupPage(
  db: Db,
  coachId: string,
  groupId: string,
  now: Date,
): Promise<GroupPage | undefined> {
  return db.transaction(async (tx) => {
    const group = await coachGroup(tx, coachId, groupId);
    if (group === undefined) return undefined;
    return {
      group,
      addable: await addableTo(tx, coachId, group),
      grid: await groupGrid(tx, coachId, group, now),
      invite: (await openGroupInvite(tx, coachId, groupId, now)) ?? null,
    };
  }, REPEATABLE_READ);
}

/**
 * A player on the coach's home, with when they last trained (R-154) and
 * their deadlines on this coach's assignments (#329, playerDeadlines).
 */
export interface HomePlayer extends LinkedAccount, PlayerDeadlines {
  /** The latest result on a repertoire the coach may see; null for none. */
  readonly lastTrained: Date | null;
}

/**
 * The graphs of the repertoires behind deadlineAssignments (this coach's
 * live assignments of linked players), each read once through the coach's
 * own scope (4 statements each), and those players' tracked keys on them
 * (one statement).
 */
async function deadlineReads(
  tx: Executor,
  coachId: string,
  facts: ReadonlyMap<string, CoachProgressFacts>,
): Promise<{
  readonly graphs: ReadonlyMap<string, RepertoireGraph>;
  readonly tracked: ReadonlyMap<string, ReadonlySet<string>>;
}> {
  const live = [...facts].map(
    ([playerId, one]) =>
      [playerId, deadlineAssignments(coachId, playerId, one)] as const,
  );
  const ids = new Set(
    live.flatMap(([, assigned]) => assigned.map((a) => a.repertoireId)),
  );
  const loaded = await loadAllVisible(tx, ownScope(coachId), ids);
  const reviews = await trackedReviews(
    tx,
    live.filter(([, assigned]) => assigned.length > 0).map(([id]) => id),
    keysOf(loaded.map((one) => one.graph)),
  );
  return {
    graphs: new Map(loaded.map((one) => [one.repertoire.id, one.graph])),
    tracked: new Map(
      [...reviews].map(([id, byKey]) => [id, new Set(byKey.keys())]),
    ),
  };
}

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * The coach's linked players by display name, each with when they last
 * trained as the coach may see it (R-154) and their deadlines on this
 * coach's live assignments (#329), from one snapshot: a fixed number of
 * statements whatever the number of players (plus 4 per repertoire the
 * coach assigned them).
 */
export function coachHomePlayers(
  db: Db,
  coachId: string,
  now: Date,
): Promise<HomePlayer[]> {
  return db.transaction(async (tx) => {
    const players = await coachPlayers(tx, coachId);
    const facts = await coachProgressFacts(
      tx,
      coachId,
      players.map((player) => player.id),
    );
    const last = await lastTrained(tx, coachId, facts);
    const { graphs, tracked } = await deadlineReads(tx, coachId, facts);
    return players.map((player) => {
      const own = facts.get(player.id);
      const deadlines =
        own === undefined
          ? NO_DEADLINES
          : playerDeadlines(coachId, player.id, own, {
              graphs,
              tracked: tracked.get(player.id) ?? NO_KEYS,
              now,
            });
      return {
        ...player,
        lastTrained: last.get(player.id) ?? null,
        ...deadlines,
      };
    });
  }, REPEATABLE_READ);
}
