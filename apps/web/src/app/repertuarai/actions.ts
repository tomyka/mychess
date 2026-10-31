'use server';

// Mano repertuarai's actions. The owner is always the session account,
// never an id from the form.
import { emptyGraph } from '@mychess/chess';
import { createRepertoire } from '@mychess/db';
import type { RepertoireLimitRefusal } from '@mychess/domain';
import { redirect } from 'next/navigation';
import { repertoireRoute } from '../../lib/routes';
import { getDb } from '../../server/db';
import { refusalState } from '../../server/refusal-state';
import {
  parseNewRepertoire,
  type NewRepertoireRefusalKey,
} from '../../server/repertoire-input';
import { requireOnboarded } from '../../server/session';

/**
 * What the "new repertoire" form shows after a submit: a refusal, and the
 * limit it names when the account is at its repertoire limit (R-162).
 */
export interface CreateState {
  readonly refusal?: NewRepertoireRefusalKey | RepertoireLimitRefusal['reason'];
  readonly limit?: number;
}

/**
 * Creates an empty repertoire (name and side) and opens it in builder mode
 * (decision 18); createRepertoire refuses it past the R-162 limit.
 */
export async function createRepertoireAction(
  _previous: CreateState,
  form: FormData,
): Promise<CreateState> {
  const account = await requireOnboarded();
  const input = parseNewRepertoire(form);
  if (!input.ok) return { refusal: input.refusal.reason };
  const { name, side } = input.value;
  const created = await createRepertoire(getDb(), {
    ownerId: account.id,
    side,
    name,
    graph: emptyGraph(side),
    now: new Date(),
  });
  if (!created.ok) return refusalState(created.refusal);
  redirect(repertoireRoute(created.value));
}
