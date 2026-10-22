/**
 * What one graph edit changed for players, as `repertoire_changes.changes`
 * stores it (plan decision 3). Internal to the package; read a stored row
 * with chess's moveChangesSchema.
 */
import { nothingChanged, type MoveChanges } from '@mychess/chess';
import type { Executor } from '../client';
import { repertoireChanges } from '../assignment-schema';

/** One saved edit: the repertoire, its new version and what changed. */
export interface RecordedEdit {
  readonly repertoireId: string;
  readonly version: number;
  readonly changes: MoveChanges;
  readonly now: Date;
}

/**
 * Stores what an edit changed for players, if anything: a player move
 * added or removed, or a move's comment or marks changed. A chapter
 * rename alone writes nothing (plan decision 3). Call it in the saving
 * transaction.
 */
export async function recordChanges(
  tx: Executor,
  edit: RecordedEdit,
): Promise<void> {
  if (nothingChanged(edit.changes)) return;
  await tx.insert(repertoireChanges).values({
    repertoireId: edit.repertoireId,
    version: edit.version,
    changes: edit.changes,
    createdAt: edit.now,
  });
}
