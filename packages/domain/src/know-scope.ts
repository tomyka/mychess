/**
 * Whether a player may mark a scope with "I know this" (R-58) or "Learn
 * again" (R-147): a move, a line or a chapter of a repertoire they train
 * now, not paused (R-46). Chess decides which moves each action changes
 * (knowThis, learnAgainKeys); this decides whether the scope is one the
 * player may mark, and resolves it to chess's Scope.
 */
import {
  chapterOf,
  lines,
  ok,
  playerKeys,
  refuse,
  type RepertoireGraph,
  type Result,
  type Scope,
  type TrainingRepertoire,
} from '@mychess/chess';
import { z } from 'zod';
import { TRAINING_REFUSALS, type TrainingRefusal } from './training';

/** Every issue of a scope reads as the one refusal (a message-catalogue key). */
const error = TRAINING_REFUSALS.notTrained;

const repertoireId = z.uuid({ error });
const chapterId = z.string({ error }).min(1, { error }).max(20, { error });

/** What the player marks, as a form names it: a move, a line or a chapter. */
export const knowScopeSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({
      kind: z.literal('move', { error }),
      repertoireId,
      moveKey: z.string({ error }).min(3, { error }).max(200, { error }),
    }),
    z.object({
      kind: z.literal('line', { error }),
      repertoireId,
      chapterId,
      // A whole number in decimal digits: '' or '1.5' is not a line.
      lineIndex: z
        .string({ error })
        .regex(/^\d{1,6}$/, { error })
        .transform(Number),
    }),
    z.object({
      kind: z.literal('chapter', { error }),
      repertoireId,
      chapterId,
    }),
  ],
  { error },
);

/** What the player marks: one move, one line of a chapter, or a chapter. */
export type KnowScope = z.output<typeof knowScopeSchema>;

/**
 * A scope the player may mark known: chess's Scope and every player move of
 * its repertoire.
 */
export interface KnownScopeKeys {
  readonly scope: Scope;
  readonly keys: readonly string[];
}

/** The chess Scope of `scope` in `graph`, or undefined when the graph lacks it. */
function chessScope(
  graph: RepertoireGraph,
  scope: KnowScope,
): Scope | undefined {
  switch (scope.kind) {
    case 'move':
      return playerKeys(graph).includes(scope.moveKey)
        ? { kind: 'moves', keys: [scope.moveKey] }
        : undefined;
    case 'line': {
      const line = lines(graph, scope.chapterId)[scope.lineIndex];
      return line === undefined ? undefined : { kind: 'line', graph, line };
    }
    case 'chapter':
      return chapterOf(graph, scope.chapterId) === undefined
        ? undefined
        : { kind: 'chapter', graph, chapterId: scope.chapterId };
  }
}

const NOT_TRAINED = refuse(TRAINING_REFUSALS.notTrained);

/**
 * May the player mark `scope`, given the repertoires they train
 * (trainingRepertoires)? Refused when they do not train its repertoire, it
 * is paused (R-46), or it has no such player move, line or chapter.
 */
export function canMarkKnown(
  trained: readonly TrainingRepertoire[],
  scope: KnowScope,
): Result<KnownScopeKeys, TrainingRefusal> {
  const repertoire = trained.find((one) => one.id === scope.repertoireId);
  if (!repertoire?.active) return NOT_TRAINED;
  const resolved = chessScope(repertoire.graph, scope);
  return resolved === undefined
    ? NOT_TRAINED
    : ok({ scope: resolved, keys: playerKeys(repertoire.graph) });
}
