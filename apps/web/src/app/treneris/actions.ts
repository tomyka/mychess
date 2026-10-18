'use server';

// The coach dashboard's actions. Each starts with requireCoach(): the coach is
// always the session account, never an id from the form (checklist 4).
import {
  addMember,
  createGroup,
  createInvite,
  deleteGroup,
  removeMember,
  renameGroup,
  revokeInvite,
  unlink,
  type Membership,
} from '@mychess/db';
import { COACH_REFUSALS, type CoachRefusal } from '@mychess/domain';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { invitePath, ROUTES } from '../../lib/routes';
import {
  parseGroupName,
  parseNewInvite,
  type GroupNameIssue,
  type InviteIssue,
} from '../../server/coach-input';
import { accountIdSchema } from '../../server/account-id';
import { requireCoach } from '../../server/coaching';
import { getDb } from '../../server/db';
import { readWebEnv } from '../../server/env';

/** A group or invite id from a form. */
const idSchema = z.uuid();

/** A refusal a group form shows. */
type GroupRefusalKey = GroupNameIssue | CoachRefusal['reason'];

/** What the "new group" form shows after a submit. */
export interface CreateGroupState {
  readonly refusal?: GroupRefusalKey;
  /** The new group's id; it keys the form, so the form comes back empty. */
  readonly createdId?: string;
}

/** Makes a group of the coach, within the limit (R-12, R-70). */
export async function createGroupAction(
  _previous: CreateGroupState,
  form: FormData,
): Promise<CreateGroupState> {
  const coach = await requireCoach();
  const name = parseGroupName(form);
  if (!name.ok) return { refusal: name.refusal.reason };
  const made = await createGroup(getDb(), coach.id, name.value, new Date());
  if (!made.ok) return { refusal: made.refusal.reason };
  refresh();
  return { createdId: made.value };
}

/** What the rename form shows after a submit. */
export interface RenameGroupState {
  readonly refusal?: GroupRefusalKey;
  readonly saved?: boolean;
}

/** Renames one of the coach's own groups; any other is not found. */
export async function renameGroupAction(
  _previous: RenameGroupState,
  form: FormData,
): Promise<RenameGroupState> {
  const coach = await requireCoach();
  const name = parseGroupName(form);
  if (!name.ok) return { refusal: name.refusal.reason };
  const groupId = idSchema.safeParse(form.get('groupId'));
  if (!groupId.success) return { refusal: COACH_REFUSALS.groupNotFound };
  const renamed = await renameGroup(
    getDb(),
    coach.id,
    groupId.data,
    name.value,
  );
  if (!renamed.ok) return { refusal: renamed.refusal.reason };
  refresh();
  return { saved: true };
}

/**
 * Deletes one of the coach's own groups and goes back to the coach dashboard;
 * any other group changes nothing.
 */
export async function deleteGroupAction(form: FormData): Promise<void> {
  const coach = await requireCoach();
  const groupId = idSchema.safeParse(form.get('groupId'));
  if (
    groupId.success &&
    (await deleteGroup(getDb(), coach.id, groupId.data)).ok
  )
    redirect(ROUTES.coach);
  refresh();
}

const membershipSchema = z.object({
  groupId: idSchema,
  playerId: accountIdSchema,
});

/** The membership a form names, for the session coach; null if malformed. */
function membershipOf(coachId: string, form: FormData): Membership | null {
  const parsed = membershipSchema.safeParse({
    groupId: form.get('groupId'),
    playerId: form.get('playerId'),
  });
  return parsed.success ? { coachId, ...parsed.data } : null;
}

/** Puts a linked player into one of the coach's own groups (R-12). */
export async function addMemberAction(form: FormData): Promise<void> {
  const coach = await requireCoach();
  const membership = membershipOf(coach.id, form);
  if (membership !== null) await addMember(getDb(), membership, new Date());
  refresh();
}

/** Takes a player out of one of the coach's own groups; the link stays. */
export async function removeMemberAction(form: FormData): Promise<void> {
  const coach = await requireCoach();
  const membership = membershipOf(coach.id, form);
  if (membership !== null) await removeMember(getDb(), membership);
  refresh();
}

/**
 * The coach ends a Coach link to one of their players and goes back to the
 * coach dashboard (the player's page is then 404); any other player changes
 * nothing.
 */
export async function unlinkPlayerAction(form: FormData): Promise<void> {
  const coach = await requireCoach();
  const playerId = accountIdSchema.safeParse(form.get('playerId'));
  if (playerId.success && (await unlink(getDb(), coach.id, playerId.data)).ok)
    redirect(ROUTES.coach);
  refresh();
}

/** What the invite form shows after a submit. */
export interface CreateInviteState {
  /** The invite link, shown once (plan decision 5). */
  readonly link?: string;
  readonly refusal?: InviteIssue | CoachRefusal['reason'];
}

/** Makes a personal or group invite and shows its link once (R-98, R-110). */
export async function createInviteAction(
  _previous: CreateInviteState,
  form: FormData,
): Promise<CreateInviteState> {
  const coach = await requireCoach();
  const request = parseNewInvite(form);
  if (!request.ok) return { refusal: request.refusal.reason };
  const made = await createInvite(getDb(), {
    coachId: coach.id,
    ...request.value,
    now: new Date(),
  });
  if (!made.ok) return { refusal: made.refusal.reason };
  refresh();
  const base = readWebEnv().BETTER_AUTH_URL;
  return { link: new URL(invitePath(made.value.token), base).toString() };
}

/** Revokes one of the coach's own invites; any other changes nothing. */
export async function revokeInviteAction(form: FormData): Promise<void> {
  const coach = await requireCoach();
  const inviteId = idSchema.safeParse(form.get('inviteId'));
  if (inviteId.success)
    await revokeInvite(getDb(), coach.id, inviteId.data, new Date());
  refresh();
}
