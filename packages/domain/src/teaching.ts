/**
 * Teaching material (R-230): a coach's own repertoire assigned to at least
 * one player or group. It is not on the coach's Today nor in its counts or
 * badge; unassigned from everyone, it returns to Today.
 */
import type { RepertoireKind } from './training';

/** A repertoire an account trains, by kind and repertoire id. */
interface TrainedRepertoire {
  readonly kind: RepertoireKind;
  readonly repertoire: { readonly id: string };
}

/** A coach's own repertoire they assigned to anyone is teaching material, not their training (R-230). */
export const isTeachingMaterial = (
  entry: TrainedRepertoire,
  assignedByMe: ReadonlySet<string>,
): boolean => entry.kind === 'own' && assignedByMe.has(entry.repertoire.id);
