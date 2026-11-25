'use server';

// "I know this" (R-58) and "Learn again" (R-147) on a move, a line or a
// chapter of a repertoire the player trains, from its owner page or its
// assigned page. The player is always the session account, never an id from
// the form. The domain parses the scope and decides whether the player may
// mark it, against the repertoire as they train it now (their own, or live
// by assignment and not paused); the db functions load and save. Anything
// else, a malformed form included, reads as one refusal.
import { knowCounts, learnAgain, markKnown } from '@mychess/db';
import {
  knowScopeSchema,
  TRAINING_REFUSALS,
  type KnowScope,
  type Result,
  type TrainingRefusal,
} from '@mychess/domain';
import { refresh } from 'next/cache';
import { getDb } from '../../server/db';
import { requireOnboarded } from '../../server/session';

/** Why an action was refused, a message-catalogue key. */
interface Refused {
  readonly ok: false;
  readonly refusal: TrainingRefusal['reason'];
}

/** A form that names no scope: refused as one the player does not train. */
const NOT_TRAINED: Refused = {
  ok: false,
  refusal: TRAINING_REFUSALS.notTrained,
};

/** How many moves each action would change, for the menu and its confirm. */
export type KnowCounts =
  | { readonly ok: true; readonly know: number; readonly again: number }
  | Refused;

/** How many moves an action changed. */
export type KnowOutcome =
  { readonly ok: true; readonly changed: number } | Refused;

/** The refusal the db gave, as the client receives it. */
const refused = (result: { readonly refusal: TrainingRefusal }): Refused => ({
  ok: false,
  refusal: result.refusal.reason,
});

/** The session player and the scope `form` names, or undefined. */
async function request(
  form: FormData,
): Promise<{ playerId: string; scope: KnowScope } | undefined> {
  const player = await requireOnboarded();
  const scope = knowScopeSchema.safeParse(Object.fromEntries(form));
  return scope.success ? { playerId: player.id, scope: scope.data } : undefined;
}

/** A write's outcome: refused, or the count changed and the page refreshed. */
function outcome(changed: Result<number, TrainingRefusal>): KnowOutcome {
  if (!changed.ok) return refused(changed);
  refresh();
  return { ok: true, changed: changed.value };
}

/** The moves "I know this" would mark and "Learn again" would return. */
export async function knowCountAction(form: FormData): Promise<KnowCounts> {
  const asked = await request(form);
  if (asked === undefined) return NOT_TRAINED;
  const counts = await knowCounts(getDb(), asked.playerId, asked.scope);
  return counts.ok ? { ok: true, ...counts.value } : refused(counts);
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
