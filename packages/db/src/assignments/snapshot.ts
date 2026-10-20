/**
 * What a fork offer keeps when an assignment ends for a player (plan
 * decision 6): the repertoire as they last had it, with the coach's
 * comments, and their own personal notes on it. Internal to the package.
 */
import { repertoireGraphSchema, type RepertoireGraph } from '@mychess/chess';
import type { Repertoire } from '@mychess/domain';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import { loadRepertoireRows } from '../repertoires/repository';
import { personalNotes, repertoires } from '../schema';

export interface Snapshot {
  readonly graph: RepertoireGraph;
  readonly personalNotes: readonly {
    readonly moveKey: string;
    readonly text: string;
  }[];
}

const notesSchema = z.array(
  z.object({ moveKey: z.string().min(1), text: z.string() }),
);

/** A fork offer's stored snapshot; parse it whenever it is read. */
export const snapshotSchema = z.object({
  graph: repertoireGraphSchema,
  personalNotes: notesSchema,
}) satisfies z.ZodType<Snapshot>;

/**
 * The repertoire `repertoireId` and `playerId`'s snapshot of it, read on
 * `tx`, or undefined if the repertoire is gone. A repertoire delete
 * unassigns first (plan decision 5), so that does not happen in practice.
 */
export async function takeSnapshot(
  tx: Executor,
  playerId: string,
  repertoireId: string,
): Promise<{ repertoire: Repertoire; snapshot: Snapshot } | undefined> {
  const loaded = await loadRepertoireRows(tx, eq(repertoires.id, repertoireId));
  if (loaded === undefined) return undefined;
  const notes = notesSchema.parse(
    await tx
      .select({ moveKey: personalNotes.moveKey, text: personalNotes.text })
      .from(personalNotes)
      .where(
        and(
          eq(personalNotes.playerAccountId, playerId),
          eq(personalNotes.repertoireId, repertoireId),
        ),
      )
      .orderBy(asc(personalNotes.moveKey)),
  );
  return {
    repertoire: loaded.repertoire,
    snapshot: { graph: loaded.graph, personalNotes: notes },
  };
}
