// One loader per coach page (plan decision 14). Each starts with
// requireCoach(); a page reads the database only through its loader.
import {
  coachGroup,
  coachGroups,
  coachInvites,
  coachLastTrained,
  coachPlayer,
  coachPlayers,
  sharedRepertoireSnapshot,
  sharedWithCoach,
  type CoachGroup,
  type CoachGroupSummary,
  type CoachInvite,
  type LinkedAccount,
  type SharedRepertoireItem,
} from '@mychess/db';
import type { RepertoireGraph, Side } from '@mychess/chess';
import type { AccountRef } from '@mychess/domain';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { daysSince } from '../lib/days-ago';
import { accountIdSchema } from './account-id';
import { ecoNamesOf } from './chapter-names';
import {
  assertCoachMaySee,
  assertCoachMaySeeBy,
  requireCoach,
} from './coaching';
import {
  playerProgressData,
  type PlayerProgressSection,
} from './coach-progress';
import { getDb } from './db';

/** A player on the coach's home, with when they last trained (R-154). */
interface CoachHomePlayer extends LinkedAccount {
  /** Whole Vilnius days since the player last trained; null for never. */
  readonly lastTrainedDays: number | null;
}

/** What the coach dashboard's home shows: the coach's own players, groups, invites. */
export interface CoachHomeData {
  readonly players: readonly CoachHomePlayer[];
  readonly groups: readonly CoachGroupSummary[];
  readonly invites: readonly CoachInvite[];
}

/** The coach dashboard's home, `/treneris`. */
export async function coachHomeData(): Promise<CoachHomeData> {
  const coach = await requireCoach();
  const db = getDb();
  const now = new Date();
  const players = await coachPlayers(db, coach.id);
  const last = await coachLastTrained(
    db,
    coach.id,
    players.map((player) => player.id),
  );
  return {
    players: players.map((player) => ({
      ...player,
      lastTrainedDays: daysSince(last.get(player.id), now),
    })),
    groups: await coachGroups(db, coach.id),
    invites: await coachInvites(db, coach.id, now),
  };
}

/** One linked player's page. */
export interface CoachPlayerPage extends LinkedAccount {
  /** The player's repertoires shared with this coach, by name (R-42). */
  readonly repertoires: readonly SharedRepertoireItem[];
  /** Where the player stands on each repertoire the coach may see (S7). */
  readonly progress: PlayerProgressSection;
}

/**
 * One linked player's page: the display name, the coach's own groups
 * (subject `profile`) and the repertoires the player shares with the
 * coach. Anything else, an unlinked player included, is 404.
 */
export async function coachPlayerData(
  rawPlayerId: unknown,
): Promise<CoachPlayerPage> {
  const coach = await requireCoach();
  const parsed = accountIdSchema.safeParse(rawPlayerId);
  if (!parsed.success) notFound();
  await assertCoachMaySee(coach, parsed.data, { kind: 'profile' });
  const db = getDb();
  const player = (await coachPlayer(db, coach.id, parsed.data)) ?? notFound();
  return {
    ...player,
    repertoires: await sharedWithCoach(db, coach.id, parsed.data),
    progress: await playerProgressData(coach, parsed.data, new Date()),
  };
}

/** A player's repertoire as the coach it is shared with sees it (R-42). */
export interface SharedRepertoirePage {
  readonly player: { readonly id: string; readonly displayName: string };
  readonly repertoire: {
    readonly id: string;
    readonly name: string;
    readonly side: Side;
  };
  /** With its move comments (R-102); never the player's personal notes. */
  readonly graph: RepertoireGraph;
  /** The coach's own notes on it by move key (R-125). */
  readonly notes: Readonly<Record<string, string>>;
  /** The names of the openings its chapters are named after. */
  readonly ecoNames: Readonly<Record<string, string>>;
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
  const { id, name, side } = shared.repertoire;
  return {
    player: { id: player.id, displayName: player.displayName },
    repertoire: { id, name, side },
    graph: shared.graph,
    notes: Object.fromEntries(
      shared.notes.map((note) => [note.moveKey, note.text]),
    ),
    ecoNames: ecoNamesOf(shared.graph, coach.locale),
  };
}

/** A group's page: the group, its members, and who else could join it. */
export interface CoachGroupPage extends CoachGroup {
  /** The coach's linked players not yet in the group, by display name. */
  readonly addable: readonly AccountRef[];
}

/**
 * One of the coach's own groups. A group is the coach's own data, not a
 * player's, so the query filtering on the coach is the check; any other
 * group is 404. The players to add are the coach's own linked players.
 */
export async function coachGroupData(
  rawGroupId: unknown,
): Promise<CoachGroupPage> {
  const coach = await requireCoach();
  const parsed = z.uuid().safeParse(rawGroupId);
  if (!parsed.success) notFound();
  const db = getDb();
  const group = (await coachGroup(db, coach.id, parsed.data)) ?? notFound();
  const members = new Set(group.members.map((member) => member.id));
  const addable = (await coachPlayers(db, coach.id))
    .filter((player) => !members.has(player.id))
    .map(({ id, displayName }) => ({ id, displayName }));
  return { ...group, addable };
}
