'use server';

// The assigned repertoire page's actions. The player is always the session
// account, never an id from the request; each db write checks again, in its
// own transaction, that the assignment is the player's and live
// (canUseAssignment, canFork, R-128). Anything refused reads as one thing on
// this page, not assigned to you, but a fork past the player's own R-162
// limits, which says the limit (R-163).
import {
  forkAssignment,
  markSeen,
  pauseAssignment,
  setAssignedPersonalNote,
} from '@mychess/db';
import {
  ASSIGNMENT_REFUSALS,
  REPERTOIRE_ISSUES,
  isRepertoireLimitRefusal,
  type RepertoireLimitRefusal,
} from '@mychess/domain';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { repertoireRoute } from '../../../../lib/routes';
import { getDb } from '../../../../server/db';
import { parsePersonalNote } from '../../../../server/personal-note-input';
import { refusalState } from '../../../../server/refusal-state';
import { requireOnboarded } from '../../../../server/session';
import type { NoteOutcome } from '../../../repertoire-view';

/** The page's one refusal: the assignment is not (or no longer) the player's. */
type NotAssigned = typeof ASSIGNMENT_REFUSALS.notFound;

const NOT_ASSIGNED: NotAssigned = ASSIGNMENT_REFUSALS.notFound;

/** What the pause form shows: the assignment's state, and any refusal. */
export interface PauseState {
  readonly paused: boolean;
  readonly refusal?: NotAssigned;
}

const pauseSchema = z.object({
  repertoireId: z.uuid(),
  paused: z.enum(['true', 'false']).transform((value) => value === 'true'),
});

/**
 * Pauses or resumes the session player's own assignment (R-46). Anything
 * else, a malformed form included, is refused and the state stays as it
 * was.
 */
export async function pauseAction(
  previous: PauseState,
  form: FormData,
): Promise<PauseState> {
  const player = await requireOnboarded();
  const request = pauseSchema.safeParse({
    repertoireId: form.get('repertoireId'),
    paused: form.get('paused'),
  });
  if (!request.success)
    return { paused: previous.paused, refusal: NOT_ASSIGNED };
  const done = await pauseAssignment(
    getDb(),
    { playerId: player.id, ...request.data },
    new Date(),
  );
  if (!done.ok) return { paused: previous.paused, refusal: NOT_ASSIGNED };
  // The page counts its train buttons again: a paused one trains nothing.
  refresh();
  return { paused: request.data.paused };
}

/**
 * What the "make my own copy" form shows after a submit: a refusal, and the
 * limit it names when it is one; a fork made goes to its own page instead.
 */
export interface ForkState {
  readonly refusal?: NotAssigned | RepertoireLimitRefusal['reason'];
  readonly limit?: number;
}

const forkSchema = z.object({ repertoireId: z.uuid() });

/**
 * Makes the session player their own copy of the assignment (R-20, R-128)
 * and goes to it. Anything but their own live assignment, or a fork past
 * their R-162 limits, is refused and nothing is written.
 */
export async function forkAction(
  _previous: ForkState,
  form: FormData,
): Promise<ForkState> {
  const player = await requireOnboarded();
  const request = forkSchema.safeParse({
    repertoireId: form.get('repertoireId'),
  });
  if (!request.success) return { refusal: NOT_ASSIGNED };
  const forked = await forkAssignment(
    getDb(),
    { playerId: player.id, repertoireId: request.data.repertoireId },
    new Date(),
  );
  if (!forked.ok)
    return isRepertoireLimitRefusal(forked.refusal)
      ? refusalState(forked.refusal)
      : { refusal: NOT_ASSIGNED };
  redirect(repertoireRoute(forked.value.forkId));
}

const seenSchema = z.object({
  repertoireId: z.uuid(),
  // A Postgres integer: anything larger would fail the cast in markSeen.
  seenVersion: z.int().nonnegative().max(2_147_483_647),
});

/**
 * The player has seen the repertoire at the version the page showed, so
 * "Updated" goes off (R-133). A malformed request, or an assignment that is
 * not theirs, changes nothing; there is nothing to show either way.
 */
export async function markSeenAction(input: unknown): Promise<void> {
  const player = await requireOnboarded();
  const request = seenSchema.safeParse(input);
  if (!request.success) return;
  await markSeen(getDb(), { playerId: player.id, ...request.data });
}

const NOTE_NOT_ASSIGNED: NoteOutcome = { ok: false, refusal: NOT_ASSIGNED };

/**
 * Sets or (with '') removes the session player's private note on a move of
 * a repertoire assigned to them live (R-21). setAssignedPersonalNote
 * decides, in its own transaction, that it is their live assignment and
 * that the note is on one of its moves; any refusal reads as not assigned.
 */
export async function setPersonalNoteAction(
  input: unknown,
): Promise<NoteOutcome> {
  const player = await requireOnboarded();
  const request = parsePersonalNote(input);
  if (!request.ok)
    return request.refusal.reason === REPERTOIRE_ISSUES.personalNoteTooLong
      ? { ok: false, refusal: request.refusal.reason }
      : NOTE_NOT_ASSIGNED;
  const saved = await setAssignedPersonalNote(getDb(), {
    ...request.value,
    playerId: player.id,
    now: new Date(),
  });
  return saved.ok ? { ok: true } : NOTE_NOT_ASSIGNED;
}
