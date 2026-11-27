import 'server-only';
// One loader per coach page (plan decision 14). Each starts with
// requireCoach() and parses its ids; the page's data then comes from one
// db read, in one snapshot, that decides access through the domain and
// filters again in SQL (#303). An undefined read is a plain 404 (plan
// decision 4).
import {
  coachDashboard,
  coachGroupPage,
  coachGroups,
  coachInvites,
  coachPlayerProgress,
  sharedRepertoireSnapshot,
  type CoachGroup,
  type CoachGroupSummary,
  type CoachInvite,
  type DashboardPlayer,
  type GroupProgress,
  type GroupProgressCell,
  type LinkedAccount,
  type PlayerProgress,
  type ProgressRow,
  type RepertoireRef,
} from '@mychess/db';
import {
  playerSummary,
  type AccountRef,
  type CoachRowFacts,
} from '@mychess/domain';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { daysSince } from '../lib/days-ago';
import { accountIdSchema } from './account-id';
import { assertCoachMaySeeBy, requireCoach } from './coaching';
import { getDb } from './db';
import {
  repertoireForViewer,
  type RepertoireForViewer,
} from './repertoire-for-viewer';

/**
 * A player on the coach's home, with when they last trained (R-154), their
 * nearest deadline and whether they are overdue (#329).
 */
interface CoachHomePlayer extends LinkedAccount {
  /** The earliest deadline of a live assignment not done (playerSummary). */
  readonly nearestDeadline: string | null;
  /** Some live assignment is overdue (playerSummary). */
  readonly overdue: boolean;
  /** Whole Vilnius days since the player last trained; null for never. */
  readonly lastTrainedDays: number | null;
}

/** What the domain reads of a dashboard row (R-155: no counts when forked). */
const rowFacts = (row: ProgressRow): CoachRowFacts => ({
  name: row.repertoire.name,
  status: row.status,
  counts: row.view.kind === 'granted' ? row.view.standing.counts : null,
});

/** The home's player, from the dashboard read, days counted from `now`. */
const homePlayerOf = (
  { lastTrained, rows, ...player }: DashboardPlayer,
  now: Date,
): CoachHomePlayer => {
  const summary = playerSummary(rows.map(rowFacts));
  return {
    ...player,
    nearestDeadline: summary.nextDeadline,
    overdue: summary.overdue,
    lastTrainedDays: daysSince(lastTrained, now),
  };
};

/** What the coach dashboard's home shows: the coach's own players, groups, invites. */
export interface CoachHomeData {
  readonly players: readonly CoachHomePlayer[];
  readonly groups: readonly CoachGroupSummary[];
  readonly invites: readonly CoachInvite[];
}

/**
 * The coach dashboard's home, `/coach`: the players and when they last
 * trained in one read; the groups and invites are the coach's own data.
 */
export async function coachHomeData(): Promise<CoachHomeData> {
  const coach = await requireCoach();
  const db = getDb();
  const now = new Date();
  const players = await coachDashboard(db, coach.id, now);
  return {
    players: players.map((player) => homePlayerOf(player, now)),
    groups: await coachGroups(db, coach.id),
    invites: await coachInvites(db, coach.id, now),
  };
}

/** The player page's progress section. */
export interface PlayerProgressSection {
  readonly rows: readonly ProgressRow[];
  /** Whole Vilnius days since the player last trained; null for never. */
  readonly lastTrainedDays: number | null;
}

/** One linked player's page. */
export interface CoachPlayerPage extends LinkedAccount {
  /** The player's repertoires shared with this coach, by name (R-42). */
  readonly repertoires: readonly RepertoireRef[];
  /** Where the player stands on each repertoire the coach may see (S7). */
  readonly progress: PlayerProgressSection;
}

/** The progress section of the player page, days counted from `now`. */
const progressSection = (
  read: PlayerProgress,
  now: Date,
): PlayerProgressSection => ({
  rows: read.rows,
  lastTrainedDays: daysSince(read.lastTrained, now),
});

/**
 * One linked player's page, from one read (coachPlayerProgress): the
 * display name, the coach's own groups, the repertoires the player shares
 * with the coach and the progress section. The read decides access
 * (isCoachLinked) in its own snapshot; anything else, an unlinked player
 * included, is 404.
 */
export async function coachPlayerData(
  rawPlayerId: unknown,
): Promise<CoachPlayerPage> {
  const coach = await requireCoach();
  const parsed = accountIdSchema.safeParse(rawPlayerId);
  if (!parsed.success) notFound();
  const now = new Date();
  const read =
    (await coachPlayerProgress(getDb(), coach.id, parsed.data, now)) ??
    notFound();
  return {
    ...read.player,
    repertoires: read.rows
      .filter((row) => row.source === 'shared')
      .map((row) => row.repertoire),
    progress: progressSection(read, now),
  };
}

/**
 * A player's repertoire as the coach it is shared with sees it (R-42):
 * its notes are the coach's own (R-125), never the player's personal
 * notes.
 */
export interface SharedRepertoirePage extends RepertoireForViewer {
  readonly player: { readonly id: string; readonly displayName: string };
}

const sharedIdsSchema = z.object({
  playerId: accountIdSchema,
  repertoireId: z.uuid(),
});

/**
 * A player's repertoire shared with the coach, read-only (subject
 * `repertoire`), read in one snapshot with the facts that decide it
 * (#278). Not shared with this coach, a player not linked, an id that does
 * not exist or a malformed one: all 404 (plan decision 4).
 */
export async function sharedRepertoireData(
  rawPlayerId: unknown,
  rawRepertoireId: unknown,
): Promise<SharedRepertoirePage> {
  const coach = await requireCoach();
  const parsed = sharedIdsSchema.safeParse({
    playerId: rawPlayerId,
    repertoireId: rawRepertoireId,
  });
  if (!parsed.success) notFound();
  const { playerId, repertoireId } = parsed.data;
  const snapshot = await sharedRepertoireSnapshot(
    getDb(),
    coach.id,
    playerId,
    repertoireId,
  );
  assertCoachMaySeeBy(
    coach,
    playerId,
    { kind: 'repertoire', repertoireId },
    snapshot.facts,
  );
  const shared = snapshot.shared ?? notFound();
  const player = snapshot.player ?? notFound();
  return {
    ...repertoireForViewer(
      shared,
      Object.fromEntries(shared.notes.map((note) => [note.moveKey, note.text])),
    ),
    player: { id: player.id, displayName: player.displayName },
  };
}

/** One member's row of the group grid. */
interface GridRow {
  readonly player: AccountRef;
  readonly lastTrainedDays: number | null;
  /** One per column, in column order; null without an assignment. */
  readonly cells: readonly (GroupProgressCell | null)[];
}

/** The group grid (R-153). */
export interface GroupGrid {
  readonly columns: readonly RepertoireRef[];
  readonly rows: readonly GridRow[];
}

/** A group's page: the group, who else could join it, and its grid. */
export interface CoachGroupPage extends CoachGroup {
  /** The coach's linked players not yet in the group, by display name. */
  readonly addable: readonly AccountRef[];
  /** Where each member stands on each group repertoire (R-153). */
  readonly grid: GroupGrid;
}

/** The grid with last trained as whole Vilnius days before `now`. */
const gridOf = (grid: GroupProgress, now: Date): GroupGrid => ({
  columns: grid.columns,
  rows: grid.rows.map((row) => ({
    player: row.player,
    lastTrainedDays: daysSince(row.lastTrained, now),
    cells: row.cells,
  })),
});

/**
 * One of the coach's own groups, from one read (coachGroupPage). A
 * group is the coach's own data, not a player's, so the query filtering on
 * the coach is the check; any other group is 404. The players to add are
 * the coach's own linked players; the grid shows only what the domain
 * grants per member.
 */
export async function coachGroupData(
  rawGroupId: unknown,
): Promise<CoachGroupPage> {
  const coach = await requireCoach();
  const parsed = z.uuid().safeParse(rawGroupId);
  if (!parsed.success) notFound();
  const now = new Date();
  const read =
    (await coachGroupPage(getDb(), coach.id, parsed.data, now)) ?? notFound();
  return {
    ...read.group,
    addable: read.addable,
    grid: gridOf(read.grid, now),
  };
}
