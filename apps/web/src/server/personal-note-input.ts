import {
  personalNoteSchema,
  REPERTOIRE_ISSUES,
  REPERTOIRE_REFUSALS,
  type Result,
} from '@mychess/domain';
import { z } from 'zod';
import { refusalOf } from './parse-refusal';

/** A request to set (or, with '', remove) a Personal note on a move (R-21). */
export interface PersonalNoteRequest {
  readonly repertoireId: string;
  readonly moveKey: string;
  /** Trimmed; '' removes the note. */
  readonly text: string;
}

/** Why a Personal note request is refused before anything is read. */
type PersonalNoteIssue =
  | typeof REPERTOIRE_ISSUES.personalNoteTooLong
  | typeof REPERTOIRE_REFUSALS.notFound;

const noteRequestSchema = z.object({
  repertoireId: z.uuid(),
  moveKey: z.string().min(1).max(120),
  text: personalNoteSchema,
});

/**
 * A Personal note request from the browser, on the owner's repertoire page
 * or an assigned one. A note too long is said so; any other malformed
 * request reads as not found.
 */
export function parsePersonalNote(
  input: unknown,
): Result<PersonalNoteRequest, { readonly reason: PersonalNoteIssue }> {
  const parsed = noteRequestSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const reason = refusalOf<PersonalNoteIssue>(
    parsed.error,
    [REPERTOIRE_ISSUES.personalNoteTooLong],
    REPERTOIRE_REFUSALS.notFound,
  );
  return { ok: false, refusal: { reason } };
}
