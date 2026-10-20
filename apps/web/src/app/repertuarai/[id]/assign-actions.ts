'use server';

// The coach's assign panel's actions (R-15, R-16, R-51, R-130). Each starts
// with requireCoach(): the coach is always the session account, never an
// id from the form. The database decides with the domain's canAssign, and
// filters by the coach again, in the write's own transaction.
import { assign, setDeadline, unassign } from '@mychess/db';
import type { AssignmentRefusal, Result } from '@mychess/domain';
import { refresh } from 'next/cache';
import {
  parseAssignForm,
  parseAssignmentRef,
  parseDeadlineForm,
  type AssignmentInputKey,
} from '../../../server/assignment-input';
import { requireCoach } from '../../../server/coaching';
import { getDb } from '../../../server/db';

/** What an assign, unassign or deadline form shows after a submit. */
export interface AssignmentActionState {
  readonly refusal?: AssignmentInputKey;
  /** How many times it saved; it keys the form, so it starts afresh. */
  readonly saved?: number;
}

/** A refusal shown, or one more save counted and the page refreshed. */
function settled(
  previous: AssignmentActionState,
  result: Result<undefined, AssignmentRefusal>,
): AssignmentActionState {
  if (!result.ok) return { refusal: result.refusal.reason };
  refresh();
  return { saved: (previous.saved ?? 0) + 1 };
}

/** Assigns the coach's own repertoire to a linked player or their group. */
export async function assignAction(
  previous: AssignmentActionState,
  form: FormData,
): Promise<AssignmentActionState> {
  const coach = await requireCoach();
  const request = parseAssignForm(form);
  if (!request.ok) return { refusal: request.refusal.reason };
  const assigned = await assign(
    getDb(),
    { coachId: coach.id, ...request.value },
    new Date(),
  );
  return settled(previous, assigned);
}

/** Ends one of the coach's own assignments; its players get a fork offer. */
export async function unassignAction(
  previous: AssignmentActionState,
  form: FormData,
): Promise<AssignmentActionState> {
  const coach = await requireCoach();
  const request = parseAssignmentRef(form);
  if (!request.ok) return { refusal: request.refusal.reason };
  const ended = await unassign(
    getDb(),
    { coachId: coach.id, ...request.value },
    new Date(),
  );
  return settled(previous, ended);
}

/** Moves one of the coach's own deadlines; an empty date is refused. */
export async function setDeadlineAction(
  previous: AssignmentActionState,
  form: FormData,
): Promise<AssignmentActionState> {
  const coach = await requireCoach();
  const request = parseDeadlineForm(form);
  if (!request.ok) return { refusal: request.refusal.reason };
  const moved = await setDeadline(getDb(), {
    coachId: coach.id,
    ...request.value,
  });
  return settled(previous, moved);
}

/** Clears one of the coach's own deadlines (R-51). */
export async function clearDeadlineAction(
  previous: AssignmentActionState,
  form: FormData,
): Promise<AssignmentActionState> {
  const coach = await requireCoach();
  const request = parseAssignmentRef(form);
  if (!request.ok) return { refusal: request.refusal.reason };
  const cleared = await setDeadline(getDb(), {
    coachId: coach.id,
    ...request.value,
    deadline: null,
  });
  return settled(previous, cleared);
}
