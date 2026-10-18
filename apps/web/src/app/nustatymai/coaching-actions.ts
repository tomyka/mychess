'use server';

import {
  coachPlayers,
  leaveGroup,
  startCoaching,
  stopCoaching,
  unlink,
} from '@mychess/db';
import type { CoachRefusal } from '@mychess/domain';
import { refresh } from 'next/cache';
import { z } from 'zod';
import { accountIdSchema } from '../../server/account-id';
import { getDb } from '../../server/db';
import { requireOnboarded } from '../../server/session';

const groupIdSchema = z.uuid();

/** Switches Coach mode on for the session account (R-11, R-13). */
export async function startCoachingAction(): Promise<void> {
  const account = await requireOnboarded();
  await startCoaching(getDb(), account.id, new Date());
  refresh();
}

/** A player the coach must unlink before switching Coach mode off. */
export interface LinkedPlayer {
  readonly id: string;
  readonly displayName: string;
}

/** What the Coach mode switch shows after switching off was asked for. */
export interface StopCoachingState {
  readonly refusal?: CoachRefusal['reason'];
  /** The players to unlink first (R-100). */
  readonly players?: readonly LinkedPlayer[];
}

/**
 * Switches Coach mode off for the session account; refused while a player
 * is linked, listing them (R-100). The open invites go with it (R-109).
 * A `useActionState` action that needs neither the previous state nor a
 * form.
 */
export async function stopCoachingAction(): Promise<StopCoachingState> {
  const account = await requireOnboarded();
  const result = await stopCoaching(getDb(), account.id, new Date());
  if (result.ok) {
    refresh();
    return {};
  }
  const players = await coachPlayers(getDb(), account.id);
  return {
    refusal: result.refusal.reason,
    players: players.map(({ id, displayName }) => ({ id, displayName })),
  };
}

/**
 * The player ends a Coach link (spec: either side may unlink). The player
 * is the session account; a coach the player is not linked to changes
 * nothing (checklist 4).
 */
export async function unlinkCoachAction(form: FormData): Promise<void> {
  const player = await requireOnboarded();
  const coachId = accountIdSchema.safeParse(form.get('coachId'));
  if (coachId.success) await unlink(getDb(), coachId.data, player.id);
  refresh();
}

/** The player leaves a group and stays linked to its coach (R-45). */
export async function leaveGroupAction(form: FormData): Promise<void> {
  const player = await requireOnboarded();
  const groupId = groupIdSchema.safeParse(form.get('groupId'));
  if (groupId.success) await leaveGroup(getDb(), player.id, groupId.data);
  refresh();
}
