'use server';

// The repertoire page's actions. Each authenticates, parses its input, asks
// ownRepertoire (the domain's access rule, enforced again by the owner
// filter in the query), then saves. The viewer is always the session account.
import type { RepertoireGraph } from '@mychess/chess';
import {
  deleteRepertoire,
  renameRepertoire,
  saveRepertoireEdit,
  setPersonalNote,
} from '@mychess/db';
import {
  canWritePersonalNote,
  personalNoteSchema,
  REPERTOIRE_ISSUES,
  REPERTOIRE_REFUSALS,
  repertoireNameSchema,
} from '@mychess/domain';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { repertoireDeletedRoute } from '../../../lib/routes';
import { ecoNamesOf } from '../../../server/chapter-names';
import { getDb } from '../../../server/db';
import { applyEdit, editRequestSchema } from '../../../server/repertoire-edit';
import { ownRepertoire } from '../../../server/repertoires';
import { requireOnboarded } from '../../../server/session';

type NotFoundKey = typeof REPERTOIRE_REFUSALS.notFound;

/** What saving a Personal note came to. */
export type NoteOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly refusal:
        typeof REPERTOIRE_ISSUES.personalNoteTooLong | NotFoundKey;
    };

const noteRequestSchema = z.object({
  repertoireId: z.uuid(),
  moveKey: z.string().min(1).max(120),
  text: personalNoteSchema,
});

/** A note too long is said so; any other malformed request reads as not found. */
const noteIssue = (error: z.ZodError): Extract<NoteOutcome, { ok: false }> => ({
  ok: false,
  refusal:
    error.issues[0]?.message === REPERTOIRE_ISSUES.personalNoteTooLong
      ? REPERTOIRE_ISSUES.personalNoteTooLong
      : REPERTOIRE_REFUSALS.notFound,
});

/**
 * Sets or (with '') removes the viewer's own private note on a move of a
 * repertoire they may view (R-21: a note is the viewer's, in either mode).
 * A note is written only on a move of the repertoire; removing one works
 * on any key (decision 11).
 */
export async function savePersonalNoteAction(
  input: unknown,
): Promise<NoteOutcome> {
  const account = await requireOnboarded();
  const request = noteRequestSchema.safeParse(input);
  if (!request.success) return noteIssue(request.error);
  const { repertoireId, moveKey, text } = request.data;
  const own = await ownRepertoire(account, repertoireId, 'view');
  if (!own.ok) return { ok: false, refusal: own.refusal.reason };
  const onMove = canWritePersonalNote(own.value.graph, moveKey, text);
  if (!onMove.ok) return { ok: false, refusal: onMove.refusal.reason };
  // The write checks access again in its own transaction: a repertoire
  // deleted since ownRepertoire read it is refused there.
  const saved = await setPersonalNote(getDb(), {
    playerId: account.id,
    repertoireId,
    moveKey,
    text,
    now: new Date(),
  });
  return saved.ok ? { ok: true } : { ok: false, refusal: saved.refusal.reason };
}

/** What the rename form shows after a submit. */
export interface RenameState {
  readonly refusal?:
    | typeof REPERTOIRE_ISSUES.nameBlank
    | typeof REPERTOIRE_ISSUES.nameTooLong
    | NotFoundKey;
  readonly saved?: boolean;
}

const renameSchema = z.object({
  repertoireId: z.uuid(REPERTOIRE_REFUSALS.notFound),
  name: repertoireNameSchema,
});

const RENAME_KEYS: readonly NonNullable<RenameState['refusal']>[] = [
  REPERTOIRE_ISSUES.nameBlank,
  REPERTOIRE_ISSUES.nameTooLong,
  REPERTOIRE_REFUSALS.notFound,
];

/** A form field as text; a missing one is empty. */
const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Renames the owner's repertoire (no version bump, decision 10). */
export async function renameRepertoireAction(
  _previous: RenameState,
  form: FormData,
): Promise<RenameState> {
  const account = await requireOnboarded();
  const request = renameSchema.safeParse({
    repertoireId: field(form, 'repertoireId'),
    name: field(form, 'name'),
  });
  if (!request.success) {
    const message = request.error.issues[0]?.message;
    const refusal = RENAME_KEYS.find((key) => key === message);
    return { refusal: refusal ?? REPERTOIRE_REFUSALS.notFound };
  }
  const own = await ownRepertoire(account, request.data.repertoireId, 'edit');
  if (!own.ok) return { refusal: own.refusal.reason };
  // The write checks ownership again: a repertoire deleted since is refused.
  const renamed = await renameRepertoire(getDb(), {
    id: request.data.repertoireId,
    ownerId: account.id,
    name: request.data.name,
    now: new Date(),
  });
  if (!renamed.ok) return { refusal: renamed.refusal.reason };
  refresh();
  return { saved: true };
}

/** What the delete confirmation shows after a submit. */
export interface DeleteState {
  readonly refusal?: NotFoundKey;
}

/**
 * Deletes the owner's repertoire with its chapters, moves and the notes on
 * it, then goes to Mano repertuarai, which says it was deleted.
 */
export async function deleteRepertoireAction(
  _previous: DeleteState,
  form: FormData,
): Promise<DeleteState> {
  const account = await requireOnboarded();
  const own = await ownRepertoire(account, form.get('repertoireId'), 'edit');
  if (!own.ok) return { refusal: own.refusal.reason };
  const deleted = await deleteRepertoire(
    getDb(),
    own.value.repertoire.id,
    account.id,
  );
  if (!deleted.ok) return { refusal: deleted.refusal.reason };
  redirect(repertoireDeletedRoute);
}

/** What one builder edit came to: the saved graph, or a catalogue key. */
export type EditOutcome =
  | {
      readonly ok: true;
      readonly graph: RepertoireGraph;
      readonly version: number;
      /** The opening names the edited chapters are now named after (R-104). */
      readonly ecoNames: Readonly<Record<string, string>>;
    }
  | { readonly ok: false; readonly refusal: string };

const refused = (refusal: string): EditOutcome => ({ ok: false, refusal });

const EDIT_ISSUES: readonly string[] = [
  REPERTOIRE_ISSUES.chapterNameBlank,
  REPERTOIRE_ISSUES.chapterNameTooLong,
  REPERTOIRE_ISSUES.commentTooLong,
];

/** A name or comment issue is said so; anything else reads as an invalid edit. */
const editIssue = (error: z.ZodError): string => {
  const message = error.issues[0]?.message ?? '';
  return EDIT_ISSUES.includes(message) ? message : 'repertoire.invalidEdit';
};

/**
 * One builder edit (authenticate, load, call the chess function that
 * decides, save). An older version than the stored one is refused before
 * anything is computed, and the save refuses a race in its own transaction.
 */
export async function editRepertoireAction(
  input: unknown,
): Promise<EditOutcome> {
  const account = await requireOnboarded();
  const request = editRequestSchema.safeParse(input);
  if (!request.success) return refused(editIssue(request.error));
  const own = await ownRepertoire(account, request.data.repertoireId, 'edit');
  if (!own.ok) return refused(own.refusal.reason);
  const { repertoire, graph } = own.value;
  if (repertoire.version !== request.data.version)
    return refused(REPERTOIRE_REFUSALS.stale);
  const edited = applyEdit(graph, request.data.op);
  if (!edited.ok) return refused(edited.refusal.reason);
  const saved = await saveRepertoireEdit(getDb(), {
    id: repertoire.id,
    ownerId: account.id,
    expectedVersion: repertoire.version,
    after: edited.value,
    now: new Date(),
  });
  if (!saved.ok) return refused(saved.refusal.reason);
  return {
    ok: true,
    graph: edited.value,
    version: saved.value.version,
    ecoNames: ecoNamesOf(edited.value, account.locale),
  };
}
