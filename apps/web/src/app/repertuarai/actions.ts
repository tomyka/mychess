'use server';

// Mano repertuarai's actions. The owner is always the session account,
// never an id from the form.
import { emptyGraph } from '@mychess/chess';
import { createRepertoire } from '@mychess/db';
import { redirect } from 'next/navigation';
import { repertoireRoute } from '../../lib/routes';
import { getDb } from '../../server/db';
import {
  parseNewRepertoire,
  type NewRepertoireRefusalKey,
} from '../../server/repertoire-input';
import { requireOnboarded } from '../../server/session';

/** What the "new repertoire" form shows after a submit. */
export interface CreateState {
  readonly refusal?: NewRepertoireRefusalKey;
}

/** Creates an empty repertoire (name and side) and opens it in builder mode (decision 18). */
export async function createRepertoireAction(
  _previous: CreateState,
  form: FormData,
): Promise<CreateState> {
  const account = await requireOnboarded();
  const input = parseNewRepertoire(form);
  if (!input.ok) return { refusal: input.refusal.reason };
  const { name, side } = input.value;
  const id = await createRepertoire(getDb(), {
    ownerId: account.id,
    side,
    name,
    graph: emptyGraph(side),
    now: new Date(),
  });
  redirect(repertoireRoute(id));
}
