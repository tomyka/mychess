import {
  moveKey,
  normalizeComment,
  ok,
  refuse,
  sideSchema,
  type RepertoireMove,
  type Result,
} from '@mychess/chess';
import { z } from 'zod';
import { entitlementLimits, type Account } from './account';
import { canUseAssignment, type AssignmentFacts } from './assignment';

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
  sideInvalid: 'repertoire.sideInvalid',
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
  limit: 'repertoire.limit',
  tooManyMoves: 'repertoire.tooManyMoves',
} as const;

/** A missing repertoire and someone else's read the same (decision 12). */
export interface RepertoireAccessRefusal {
  readonly reason: typeof REPERTOIRE_REFUSALS.notFound;
}

type RepertoireAccess = Result<undefined, RepertoireAccessRefusal>;

const NOT_FOUND: RepertoireAccess = refuse(REPERTOIRE_REFUSALS.notFound);

/** The one owner check: only the owner reaches it; anyone else, not found. */
const ownerOnly = (
  viewer: Pick<Account, 'id'>,
  repertoire: Pick<Repertoire, 'ownerId'>,
): RepertoireAccess => (viewer.id === repertoire.ownerId ? ok() : NOT_FOUND);

/**
 * How an account reaches a repertoire (Q26, R-39), one kind per way:
 *
 * - `own`: the owner's own repertoire, private unless shared (R-39);
 * - `shared`: a player's repertoire shared with a linked coach (R-42),
 *   decided by canCoachSee;
 * - `assigned`: a coach's repertoire live for a player it is assigned to
 *   (R-16, R-128), decided by canUseAssignment.
 *
 * Each kind is one query filter in @mychess/db (repertoireScope), so the
 * query enforces again what the domain decides, and each is written once.
 */
export type RepertoireScope =
  | { readonly kind: 'own'; readonly ownerId: string }
  | {
      readonly kind: 'shared';
      readonly coachId: string;
      readonly playerId: string;
    }
  | { readonly kind: 'assigned'; readonly playerId: string };

/** The owner's own repertoires (R-39). */
export const ownScope = (ownerId: string): RepertoireScope => ({
  kind: 'own',
  ownerId,
});

/** A player's repertoires shared with a linked coach (R-42). */
export const sharedScope = (
  coachId: string,
  playerId: string,
): RepertoireScope => ({ kind: 'shared', coachId, playerId });

/** The coach repertoires live for a player through an assignment (R-16). */
export const assignedScope = (playerId: string): RepertoireScope => ({
  kind: 'assigned',
  playerId,
});

/** What an account does with a repertoire it reaches. */
export type RepertoirePurpose = 'view' | 'edit';

/**
 * What a scope allows: viewing through any, editing only through `own`. A
 * shared repertoire is read-only for its coach (R-42) and an assigned one
 * for its player (S5 spec: the assigned view is read-only; their own copy
 * is a fork, R-43). Anything else reads as not found.
 */
export function canUseScope(
  scope: RepertoireScope,
  purpose: RepertoirePurpose,
): RepertoireAccess {
  return purpose === 'view' || scope.kind === 'own' ? ok() : NOT_FOUND;
}

/**
 * May `viewer` see the repertoire as its owner (the `own` scope)? Only the
 * owner (R-39). A coach sees a shared one through canCoachSee and a player
 * an assigned one through canUseAssignment, never through this rule.
 */
export const canViewRepertoire: typeof ownerOnly = ownerOnly;

/**
 * May a player keep Personal notes on a repertoire? On their own, and on
 * one assigned to them now and not forked (R-21, canUseAssignment); any
 * other reads as not found.
 */
export function canKeepPersonalNotes(
  player: Pick<Account, 'id'>,
  repertoire: Pick<Repertoire, 'ownerId'>,
  assignment: AssignmentFacts | undefined,
): RepertoireAccess {
  return ownerOnly(player, repertoire).ok || canUseAssignment(assignment).ok
    ? ok()
    : NOT_FOUND;
}

/**
 * May a Personal note with `text` be saved on `key` of `graph`? A note is
 * written only on a move of the repertoire; removing one ('') is allowed
 * on any key, so a note left on a removed move can still go (decision 11).
 * Any other key reads as not found, like any other malformed request.
 */
export function canWritePersonalNote(
  graph: { readonly moves: readonly Pick<RepertoireMove, 'from' | 'san'>[] },
  key: string,
  text: string,
): RepertoireAccess {
  if (text === '') return ok();
  return graph.moves.some((m) => moveKey(m.from, m.san) === key)
    ? ok()
    : NOT_FOUND;
}

/**
 * Who may change a repertoire's moves, chapters and comments: its owner
 * only, as no other scope edits (canUseScope).
 */
export const canEditRepertoire: typeof ownerOnly = ownerOnly;

/** An edit computed from a version the repertoire has moved past (S3 decision 6). */
export interface RepertoireStaleRefusal {
  readonly reason: typeof REPERTOIRE_REFUSALS.stale;
}

/**
 * May `viewer` save an edit computed from `expectedVersion`? The owner
 * first (canEditRepertoire, decision 12), so a stranger never learns the
 * version; then the version (S3 decision 6).
 */
export function canEditRepertoireAt(
  viewer: Pick<Account, 'id'>,
  repertoire: Pick<Repertoire, 'ownerId' | 'version'>,
  expectedVersion: number,
): Result<undefined, RepertoireAccessRefusal | RepertoireStaleRefusal> {
  const allowed = canEditRepertoire(viewer, repertoire);
  if (!allowed.ok) return allowed;
  return repertoire.version === expectedVersion
    ? ok()
    : refuse(REPERTOIRE_REFUSALS.stale);
}

/** A repertoire limit of the owner's entitlement reached (R-162), naming it. */
export interface RepertoireLimitRefusal {
  readonly reason:
    typeof REPERTOIRE_REFUSALS.limit | typeof REPERTOIRE_REFUSALS.tooManyMoves;
  readonly limit: number;
}

type LimitCheck = Result<undefined, RepertoireLimitRefusal>;

/**
 * May `owner`, who has `repertoireCount` repertoires, add one more (R-162)?
 * Forks count as any other repertoire; only the automatic fork of a
 * deleting coach is made past the limit (R-163), and it never asks.
 */
export function canAddRepertoire(
  owner: Pick<Account, 'entitlement'>,
  repertoireCount: number,
): LimitCheck {
  const limit = entitlementLimits(owner.entitlement).repertoires;
  return repertoireCount < limit
    ? ok()
    : refuse(REPERTOIRE_REFUSALS.limit, { limit });
}

/**
 * May a repertoire of `owner` go from `moves.before` to `moves.after`
 * moves (R-162)? Refused only when it grows past the limit: an edit that
 * does not grow one already over it (an automatic fork, R-163), such as a
 * removal, is allowed. A new repertoire starts from 0.
 */
export function canHoldMoves(
  owner: Pick<Account, 'entitlement'>,
  moves: { readonly before: number; readonly after: number },
): LimitCheck {
  const limit = entitlementLimits(owner.entitlement).repertoireMoves;
  return moves.after > limit && moves.after > moves.before
    ? refuse(REPERTOIRE_REFUSALS.tooManyMoves, { limit })
    : ok();
}
