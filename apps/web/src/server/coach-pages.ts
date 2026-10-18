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

/**
 * One of the coach's own groups. A group is the coach's own data, not a
 * player's, so the query filtering on the coach is the check; any other
 * group is 404.
 */
export async function coachGroupData(rawGroupId: unknown): Promise<CoachGroup> {
  const coach = await requireCoach();
  const parsed = z.uuid().safeParse(rawGroupId);
  if (!parsed.success) notFound();
  return (await coachGroup(getDb(), coach.id, parsed.data)) ?? notFound();
}
