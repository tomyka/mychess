/**
 * What a fork offer keeps when an assignment ends for a player (plan
 * decision 6): the repertoire as they last had it, with the coach's
 * comments, and their own personal notes on it. Internal to the package.
 */
import { repertoireGraphSchema, type RepertoireGraph } from '@mychess/chess';
import type { PlayerRepertoire, Repertoire } from '@mychess/domain';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import {
  loadRepertoireRows,
  type LoadedRepertoire,
} from '../repertoires/repository';
import { personalNotes, repertoires } from '../schema';
import { inPairs, pairKey, uniquePairs } from './pairs';

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

/** A repertoire as it was taken, and one player's snapshot of it. */
export interface Taken {
  readonly repertoire: Repertoire;
  readonly snapshot: Snapshot;
}

const pairNotesSchema = z.array(
  z.object({
    playerId: z.string().min(1),
    repertoireId: z.uuid(),
    moveKey: z.string().min(1),
    text: z.string(),
  }),
);

/** Each distinct repertoire of `pairs` that still exists, loaded once. */
async function loadEach(
  tx: Executor,
  pairs: readonly PlayerRepertoire[],
): Promise<Map<string, LoadedRepertoire>> {
  const loaded = new Map<string, LoadedRepertoire>();
  for (const id of new Set(pairs.map((pair) => pair.repertoireId))) {
    const one = await loadRepertoireRows(tx, eq(repertoires.id, id));
    if (one !== undefined) loaded.set(id, one);
  }
  return loaded;
}

/** The personal notes of every pair, in one statement, by move key. */
async function notesOf(
  tx: Executor,
  pairs: readonly PlayerRepertoire[],
): Promise<z.infer<typeof pairNotesSchema>> {
  if (pairs.length === 0) return [];
  return pairNotesSchema.parse(
    await tx
      .select({
        playerId: personalNotes.playerAccountId,
        repertoireId: personalNotes.repertoireId,
        moveKey: personalNotes.moveKey,
        text: personalNotes.text,
      })
      .from(personalNotes)
      .where(
        inPairs(
          personalNotes.playerAccountId,
          personalNotes.repertoireId,
          pairs,
        ),
      )
      .orderBy(
        asc(personalNotes.playerAccountId),
        asc(personalNotes.repertoireId),
        asc(personalNotes.moveKey),
      ),
  );
}

/**
 * Each pair's repertoire and the player's snapshot of it, read on `tx`, by
 * `pairKey`; a pair whose repertoire is gone has none. Each repertoire is
 * loaded once and the notes are read in one statement, whatever the pairs.
 */
export async function takeSnapshots(
  tx: Executor,
  pairs: readonly PlayerRepertoire[],
): Promise<Map<string, Taken>> {
  const loaded = await loadEach(tx, pairs);
  const kept = uniquePairs(pairs).filter((pair) =>
    loaded.has(pair.repertoireId),
  );
  const notes = await notesOf(tx, kept);
  const taken = new Map<string, Taken>();
  for (const pair of kept) {
    const one = loaded.get(pair.repertoireId);
    if (one === undefined) continue;
    taken.set(pairKey(pair), {
      repertoire: one.repertoire,
      snapshot: {
        graph: one.graph,
        personalNotes: notes
          .filter((note) => pairKey(note) === pairKey(pair))
          .map(({ moveKey, text }) => ({ moveKey, text })),
      },
    });
  }
  return taken;
}

/**
 * The repertoire `repertoireId` and `playerId`'s snapshot of it, read on
 * `tx`, or undefined if the repertoire is gone. A repertoire delete
 * unassigns first (plan decision 5), so that does not happen in practice.
 */
export async function takeSnapshot(
  tx: Executor,
  playerId: string,
  repertoireId: string,
): Promise<Taken | undefined> {
  const pair = { playerId, repertoireId };
  return (await takeSnapshots(tx, [pair])).get(pairKey(pair));
}
