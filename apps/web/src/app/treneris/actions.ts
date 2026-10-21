'use server';

// The coach dashboard's actions. Each starts with requireCoach(): the coach is
// always the session account, never an id from the form (checklist 4).
import {
  addMember,
  createGroup,
  createInvite,
  deleteCoachNote,
  deleteGroup,
  removeMember,
  renameGroup,
  revokeInvite,
  unlink,
  upsertCoachNote,
  type Membership,
} from '@mychess/db';
import {
  COACH_REFUSALS,
  INVITE_REFUSALS,
  type CoachRefusal,
  type InviteRefusal,
  type Result,
} from '@mychess/domain';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { invitePath, ROUTES } from '../../lib/routes';
import {
  parseCoachNote,
  parseCoachNoteMove,
  parseGroupName,
  parseNewInvite,
  type CoachNoteRefusalKey,
  type GroupNameIssue,
  type InviteIssue,
} from '../../server/coach-input';
import { accountIdSchema } from '../../server/account-id';
import { requireCoach } from '../../server/coaching';
import { getDb } from '../../server/db';
import { refusalAt, refusalState } from '../../server/parse-refusal';
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
    (await deleteGroup(getDb(), coach.id, groupId.data, new Date())).ok
  )
    redirect(ROUTES.coach);
  refresh();
}

/** What a coach's member or unlink form shows after a submit: its refusal. */
export interface CoachActionState {
  readonly refusal?: CoachRefusal['reason'];
}

const membershipSchema = z.object({
  groupId: idSchema,
  playerId: accountIdSchema,
});

/**
 * The membership a form names, for the session coach. A malformed group
 * is not found and a malformed player is not linked, as their ids would be.
 */
function membershipOf(
  coachId: string,
  form: FormData,
): Result<Membership, CoachRefusal> {
  const parsed = membershipSchema.safeParse({
    groupId: form.get('groupId'),
    playerId: form.get('playerId'),
  });
  if (parsed.success) return { ok: true, value: { coachId, ...parsed.data } };
  const reason = refusalAt<CoachRefusal['reason']>(
    parsed.error,
    { playerId: COACH_REFUSALS.notLinked },
    COACH_REFUSALS.groupNotFound,
  );
  return { ok: false, refusal: { reason } };
}

/** Puts a linked player into one of the coach's own groups (R-12). */
export async function addMemberAction(
  _previous: CoachActionState,
  form: FormData,
): Promise<CoachActionState> {
  const coach = await requireCoach();
  const membership = membershipOf(coach.id, form);
  const added = membership.ok
    ? await addMember(getDb(), membership.value, new Date())
    : membership;
  refresh();
  return refusalState(added);
}

/** Takes a player out of one of the coach's own groups; the link stays. */
export async function removeMemberAction(
  _previous: CoachActionState,
  form: FormData,
): Promise<CoachActionState> {
  const coach = await requireCoach();
  const membership = membershipOf(coach.id, form);
  const removed = membership.ok
    ? await removeMember(getDb(), membership.value, new Date())
    : membership;
  refresh();
  return refusalState(removed);
}

/**
 * The coach ends a Coach link to one of their players and goes back to the
 * coach dashboard (the player's page is then 404); any other player is
 * refused as not linked and changes nothing.
 */
export async function unlinkPlayerAction(
  _previous: CoachActionState,
  form: FormData,
): Promise<CoachActionState> {
  const coach = await requireCoach();
  const playerId = accountIdSchema.safeParse(form.get('playerId'));
  if (!playerId.success) {
    refresh();
    return { refusal: COACH_REFUSALS.notLinked };
  }
  const unlinked = await unlink(getDb(), coach.id, playerId.data, new Date());
  if (unlinked.ok) redirect(ROUTES.coach);
  refresh();
  return refusalState(unlinked);
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

const INVALID_INVITE: Result<undefined, InviteRefusal> = {
  ok: false,
  refusal: { reason: INVITE_REFUSALS.invalid },
};

/** What an invite's Revoke shows after a submit: its refusal. */
export interface RevokeInviteState {
  readonly refusal?: InviteRefusal['reason'];
}

/**
 * Revokes one of the coach's own open invites; any other (used, expired,
 * revoked or not the coach's) is refused as not valid and changes nothing.
 */
export async function revokeInviteAction(
  _previous: RevokeInviteState,
  form: FormData,
): Promise<RevokeInviteState> {
  const coach = await requireCoach();
  const inviteId = idSchema.safeParse(form.get('inviteId'));
  const revoked = inviteId.success
    ? await revokeInvite(getDb(), coach.id, inviteId.data, new Date())
    : INVALID_INVITE;
  refresh();
  return refusalState(revoked);
}

/** What saving or deleting a coach note came to: done, or its refusal. */
export interface CoachNoteState {
  readonly refusal?: CoachNoteRefusalKey;
}

/**
 * Writes or replaces the coach's note on a move of a player's repertoire
 * shared with the coach (R-42). The repository decides with the domain's
 * canWriteCoachNote on facts it holds while writing; any other repertoire
 * is refused and nothing is written.
 */
export async function saveCoachNoteAction(
  input: unknown,
): Promise<CoachNoteState> {
  const coach = await requireCoach();
  const note = parseCoachNote(input);
  if (!note.ok) return { refusal: note.refusal.reason };
  const saved = await upsertCoachNote(getDb(), {
    coachId: coach.id,
    ...note.value,
    now: new Date(),
  });
  return refusalState(saved);
}

/**
 * Removes the coach's own note on a move of a repertoire shared with the
 * coach; the repository decides (canCoachSee) in the delete's transaction.
 */
export async function deleteCoachNoteAction(
  input: unknown,
): Promise<CoachNoteState> {
  const coach = await requireCoach();
  const move = parseCoachNoteMove(input);
  if (!move.ok) return { refusal: move.refusal.reason };
  const removed = await deleteCoachNote(getDb(), {
    coachId: coach.id,
    ...move.value,
  });
  return refusalState(removed);
}
