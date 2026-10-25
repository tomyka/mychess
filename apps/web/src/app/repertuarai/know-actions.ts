'use server';

// "I know this" (R-58) and "Learn again" (R-147) on a move, a line or a
// chapter of a repertoire the player trains, from its owner page or its
// assigned page. The player is always the session account, never an id from
// the form; the db functions resolve the scope against the repertoire as the
// player trains it now (their own, or live by assignment and not paused),
// and anything else, a malformed form included, reads as one refusal.
import { knowCount, learnAgain, markKnown, type KnowScope } from '@mychess/db';
import { refresh } from 'next/cache';
import { z } from 'zod';
import { getDb } from '../../server/db';
import { requireOnboarded } from '../../server/session';

/** The one refusal: not a scope the player trains now. */
type NotTrained = 'training.notTrained';

const NOT_TRAINED = {
  ok: false,
  refusal: 'training.notTrained',
} as const satisfies { ok: false; refusal: NotTrained };

/** How many moves each action would change, for the menu and its confirm. */
export type KnowCounts =
  | { readonly ok: true; readonly know: number; readonly again: number }
  | { readonly ok: false; readonly refusal: NotTrained };

/** How many moves an action changed. */
export type KnowOutcome =
  | { readonly ok: true; readonly changed: number }
  | { readonly ok: false; readonly refusal: NotTrained };

const repertoireId = z.uuid();
const chapterId = z.string().min(1).max(20);

const scopeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move'),
    repertoireId,
    moveKey: z.string().min(3).max(200),
  }),
  z.object({
    kind: z.literal('line'),
    repertoireId,
    chapterId,
    // A whole number in decimal digits: '' or '1.5' is not a line.
    lineIndex: z
      .string()
      .regex(/^\d{1,6}$/)
      .transform(Number),
  }),
  z.object({ kind: z.literal('chapter'), repertoireId, chapterId }),
]);

/** The session player and the scope `form` names, or undefined. */
async function request(
  form: FormData,
): Promise<{ playerId: string; scope: KnowScope } | undefined> {
  const player = await requireOnboarded();
  const scope = scopeSchema.safeParse(Object.fromEntries(form));
  return scope.success ? { playerId: player.id, scope: scope.data } : undefined;
}

/** A write's outcome: refused, or the count changed and the page refreshed. */
function outcome(changed: number | undefined): KnowOutcome {
  if (changed === undefined) return NOT_TRAINED;
  refresh();
  return { ok: true, changed };
}

/** The moves "I know this" would mark and "Learn again" would return. */
export async function knowCountAction(form: FormData): Promise<KnowCounts> {
  const asked = await request(form);
  if (asked === undefined) return NOT_TRAINED;
  const { playerId, scope } = asked;
  const know = await knowCount(getDb(), playerId, scope, 'know');
  const again = await knowCount(getDb(), playerId, scope, 'again');
  return know === undefined || again === undefined
    ? NOT_TRAINED
    : { ok: true, know, again };
}

/** "I know this": the scope's new moves skip the learn pass (R-58). */
export async function markKnownAction(form: FormData): Promise<KnowOutcome> {
  const asked = await request(form);
  if (asked === undefined) return NOT_TRAINED;
  return outcome(
    await markKnown(getDb(), asked.playerId, asked.scope, new Date()),
  );
}

/** "Learn again": the scope's skipped, never drilled moves go back (R-147). */
export async function learnAgainAction(form: FormData): Promise<KnowOutcome> {
  const asked = await request(form);
  if (asked === undefined) return NOT_TRAINED;
  return outcome(await learnAgain(getDb(), asked.playerId, asked.scope));
}
