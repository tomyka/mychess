// One loader per coach page (plan decision 14). Each starts with
// requireCoach(); a page reads the database only through its loader.
import {
  coachGroup,
  coachGroups,
  coachInvites,
  coachPlayer,
  coachPlayers,
  type CoachGroup,
  type CoachGroupSummary,
  type CoachInvite,
  type LinkedAccount,
} from '@mychess/db';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { accountIdSchema } from './account-id';
import { assertCoachMaySee, requireCoach } from './coaching';
import { getDb } from './db';

/** What the coach dashboard's home shows: the coach's own players, groups, invites. */
export interface CoachHomeData {
  readonly players: readonly LinkedAccount[];
  readonly groups: readonly CoachGroupSummary[];
  readonly invites: readonly CoachInvite[];
}

/** The coach dashboard's home, `/treneris`. */
export async function coachHomeData(): Promise<CoachHomeData> {
  const coach = await requireCoach();
  const db = getDb();
  return {
    players: await coachPlayers(db, coach.id),
    groups: await coachGroups(db, coach.id),
    invites: await coachInvites(db, coach.id, new Date()),
  };
}

/**
 * One linked player's page: the display name and the coach's own groups
 * (subject `profile`). Anything else, an unlinked player included, is 404.
 */
export async function coachPlayerData(
  rawPlayerId: unknown,
): Promise<LinkedAccount> {
  const coach = await requireCoach();
  const parsed = accountIdSchema.safeParse(rawPlayerId);
  if (!parsed.success) notFound();
  await assertCoachMaySee(coach, parsed.data, { kind: 'profile' });
  return (await coachPlayer(getDb(), coach.id, parsed.data)) ?? notFound();
}

/** A linked player the coach can put into a group. */
interface AddablePlayer {
  readonly id: string;
  readonly displayName: string;
}

/** A group's page: the group, its members, and who else could join it. */
export interface CoachGroupPage extends CoachGroup {
  /** The coach's linked players not yet in the group, by display name. */
  readonly addable: readonly AddablePlayer[];
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
