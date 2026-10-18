import { normalizeComment, sideSchema, type Result } from '@mychess/chess';
import { z } from 'zod';
import type { Account } from './account';

export const REPERTOIRE_NAME_MAX = 80;
export const CHAPTER_NAME_MAX = 80;
export const COMMENT_MAX = 2000;
export const PERSONAL_NOTE_MAX = 2000;

/** Message-catalogue keys for invalid repertoire input. */
export const REPERTOIRE_ISSUES = {
  nameBlank: 'repertoire.nameBlank',
  nameTooLong: 'repertoire.nameTooLong',
  chapterNameBlank: 'chapter.nameBlank',
  chapterNameTooLong: 'chapter.nameTooLong',
  commentTooLong: 'comment.tooLong',
  personalNoteTooLong: 'personalNote.tooLong',
} as const;

const boundedName = (max: number, blank: string, tooLong: string) =>
  z.string().trim().min(1, blank).max(max, tooLong);

/** A repertoire's name: trimmed, never blank, at most 80 characters. */
export const repertoireNameSchema = boundedName(
  REPERTOIRE_NAME_MAX,
  REPERTOIRE_ISSUES.nameBlank,
  REPERTOIRE_ISSUES.nameTooLong,
);

/** A chapter's custom name: trimmed, never blank, at most 80 characters. */
export const chapterNameSchema = boundedName(
  CHAPTER_NAME_MAX,
  REPERTOIRE_ISSUES.chapterNameBlank,
  REPERTOIRE_ISSUES.chapterNameTooLong,
);

/** A typed move comment in the form PGN carries; '' removes it (R-102, decision 2). */
export const commentSchema = z
  .string()
  .transform((text) => normalizeComment(text) ?? '')
  .pipe(z.string().max(COMMENT_MAX, REPERTOIRE_ISSUES.commentTooLong));

/** A private Personal note (R-21); line breaks kept; '' removes it. */
export const personalNoteSchema = z
  .string()
  .trim()
  .max(PERSONAL_NOTE_MAX, REPERTOIRE_ISSUES.personalNoteTooLong);

/** A repertoire's own facts, as the database hands them over (parsed at the edge). */
export const repertoireSchema = z.object({
  id: z.uuid(),
  ownerId: z.string().min(1),
  side: sideSchema,
  name: z.string(),
  version: z.number().int().positive(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Repertoire = z.infer<typeof repertoireSchema>;

/** Message-catalogue keys for repertoire refusals. */
export const REPERTOIRE_REFUSALS = {
  notFound: 'repertoire.notFound',
  stale: 'repertoire.stale',
} as const;

/** A missing repertoire and someone else's read the same (decision 12). */
export interface RepertoireAccessRefusal {
  readonly reason: typeof REPERTOIRE_REFUSALS.notFound;
}

type RepertoireAccess = Result<undefined, RepertoireAccessRefusal>;

const ALLOWED: RepertoireAccess = { ok: true, value: undefined };
const NOT_FOUND: RepertoireAccess = {
  ok: false,
  refusal: { reason: REPERTOIRE_REFUSALS.notFound },
};

const owns = (
  viewer: Pick<Account, 'id'>,
  repertoire: Pick<Repertoire, 'ownerId'>,
) => viewer.id === repertoire.ownerId;

/**
 * Who may see a repertoire. S3: its owner only (R-39: own repertoires are
 * private). S4 adds a coach it is shared with; S5 adds assigned ones.
 */
export function canViewRepertoire(
  viewer: Pick<Account, 'id'>,
  repertoire: Pick<Repertoire, 'ownerId'>,
): RepertoireAccess {
  return owns(viewer, repertoire) ? ALLOWED : NOT_FOUND;
}

/** Who may change a repertoire's moves, chapters and comments. S3: its owner only. */
export function canEditRepertoire(
  viewer: Pick<Account, 'id'>,
  repertoire: Pick<Repertoire, 'ownerId'>,
): RepertoireAccess {
  return owns(viewer, repertoire) ? ALLOWED : NOT_FOUND;
}
