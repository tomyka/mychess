/**
 * What one graph edit changed for players, as `repertoire_changes.changes`
 * stores it (plan decision 3). Internal to the package.
 */
import type { MoveChanges } from '@mychess/chess';
import { z } from 'zod';
import type { Executor } from '../client';
import { repertoireChanges } from '../assignment-schema';

const linkSchema = z.object({
  moveKey: z.string().min(1),
  chapterId: z.string().min(1),
});

/** chess's MoveChanges; parse a stored row with it whenever it is read. */
export const moveChangesSchema = z.object({
  added: z.array(linkSchema),
  removed: z.array(linkSchema),
  annotated: z.number().int().nonnegative(),
}) satisfies z.ZodType<MoveChanges>;

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
  const { added, removed, annotated } = edit.changes;
  if (added.length + removed.length + annotated === 0) return;
  await tx.insert(repertoireChanges).values({
    repertoireId: edit.repertoireId,
    version: edit.version,
    changes: edit.changes,
    createdAt: edit.now,
  });
}
