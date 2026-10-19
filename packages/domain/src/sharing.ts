import type { Result } from '@mychess/chess';
import { z } from 'zod';
import {
  canCoachSee,
  type AccessRefusal,
  type CoachAccessFacts,
} from './coach-access';
import { COMMENT_MAX } from './repertoire';

/** Message-catalogue keys for share refusals; the UI translates them. */
export const SHARE_REFUSALS = {
  notOwner: 'share.notOwner',
  notLinked: 'share.notLinked',
} as const;

export interface ShareRefusal {
  readonly reason: (typeof SHARE_REFUSALS)[keyof typeof SHARE_REFUSALS];
}

const ALLOWED: Result<undefined, never> = { ok: true, value: undefined };

/**
 * Only the owner shares, only an own repertoire, and only with a coach
 * linked to them (R-42); there is no link to oneself. The coach then sees
 * it read-only through canCoachSee.
 */
export function canShare(
  actorId: string,
  repertoire: { readonly ownerId: string },
  coachId: string,
  linked: boolean,
): Result<undefined, ShareRefusal> {
  if (repertoire.ownerId !== actorId)
    return { ok: false, refusal: { reason: SHARE_REFUSALS.notOwner } };
  return linked && coachId !== actorId
    ? ALLOWED
    : { ok: false, refusal: { reason: SHARE_REFUSALS.notLinked } };
}

/** The same limit as a move comment (plan, spec gap 6). */
export const COACH_NOTE_MAX = COMMENT_MAX;

/** Message-catalogue keys for invalid coach note input. */
export const COACH_NOTE_ISSUES = {
  blank: 'coachNote.blank',
  tooLong: 'coachNote.tooLong',
} as const;

/** A Coach note's text: trimmed, never blank, at most COACH_NOTE_MAX characters. */
export const coachNoteSchema = z
  .string()
  .trim()
  .min(1, COACH_NOTE_ISSUES.blank)
  .max(COACH_NOTE_MAX, COACH_NOTE_ISSUES.tooLong);

/** Message-catalogue keys for coach note refusals. */
export const COACH_NOTE_REFUSALS = {
  moveNotFound: 'coachNote.moveNotFound',
} as const;

export interface CoachNoteRefusal {
  readonly reason: (typeof COACH_NOTE_REFUSALS)[keyof typeof COACH_NOTE_REFUSALS];
}

/** Who writes a coach note, and on whose repertoire. */
export interface CoachNoteTarget {
  readonly coachId: string;
  readonly playerId: string;
  readonly repertoireId: string;
}

/**
 * May the coach write a note on a move of the player's repertoire? Only
 * where canCoachSee lets them see the repertoire (shared with them, R-42),
 * and only on a move the repertoire has. Access is decided first, so a
 * refused coach learns nothing about the moves.
 */
export function canWriteCoachNote(
  note: CoachNoteTarget,
  facts: CoachAccessFacts,
  moveExists: boolean,
): Result<undefined, AccessRefusal | CoachNoteRefusal> {
  const access = canCoachSee(
    note.coachId,
    note.playerId,
    { kind: 'repertoire', repertoireId: note.repertoireId },
    facts,
  );
  if (!access.ok) return access;
  return moveExists
    ? ALLOWED
    : {
        ok: false,
        refusal: { reason: COACH_NOTE_REFUSALS.moveNotFound },
      };
}
