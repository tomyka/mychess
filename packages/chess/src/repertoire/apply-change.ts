/**
 * Deciding one change to a saved repertoire: a builder edit (`applyEdit`) or
 * an imported file added to it (`mergeInto`, R-101). The caller saves the
 * graph it gives; a refusal leaves the repertoire as it was.
 */
import type { ImportedRepertoire } from '../pgn/import-pgn';
import { ok, type Result } from '../result';
import { applyEdit, type EditOp, type EditRefusal } from './edit';
import type { RepertoireGraph } from './graph';
import { mergeInto, type MergeRefusal, type NothingToAdd } from './merge';

/** One change to a repertoire; the caller parsed it at its edge. */
export type RepertoireChange =
  | { readonly kind: 'edit'; readonly op: EditOp }
  | { readonly kind: 'import'; readonly imported: ImportedRepertoire };

/** The refusals a change of this kind can come to; each is a catalogue key. */
export type ChangeRefusal<C extends RepertoireChange = RepertoireChange> =
  C extends { readonly kind: 'edit' }
    ? EditRefusal
    : MergeRefusal | NothingToAdd;

export interface AppliedChange {
  readonly graph: RepertoireGraph;
  /** The first chapter an import added (the repertoire opens on it); null for a builder edit. */
  readonly firstChapterId: string | null;
}

function applyEditChange(
  graph: RepertoireGraph,
  op: EditOp,
): Result<AppliedChange, EditRefusal> {
  const edited = applyEdit(graph, op);
  if (!edited.ok) return edited;
  return ok({ graph: edited.value, firstChapterId: null });
}

/**
 * Adds the file's games as new chapters; a file that adds nothing is refused
 * (R-115). The moves the merge left out are not reported: the preview showed
 * them before the owner confirmed.
 */
function applyImportChange(
  graph: RepertoireGraph,
  imported: ImportedRepertoire,
): Result<AppliedChange, MergeRefusal | NothingToAdd> {
  const merged = mergeInto(graph, imported);
  if (!merged.ok) return merged;
  const { added } = merged.value;
  if (!added.ok) return added;
  return ok({
    graph: merged.value.graph,
    firstChapterId: added.value.firstChapterId,
  });
}

/** The graph `change` makes of `graph`, or why it is refused; `graph` is not changed. */
export function applyChange<C extends RepertoireChange>(
  graph: RepertoireGraph,
  change: C,
): Result<AppliedChange, ChangeRefusal<C>>;
export function applyChange(
  graph: RepertoireGraph,
  change: RepertoireChange,
): Result<AppliedChange, ChangeRefusal> {
  switch (change.kind) {
    case 'edit':
      return applyEditChange(graph, change.op);
    case 'import':
      return applyImportChange(graph, change.imported);
  }
}
