'use server';

// "Share with coach" (R-42). The owner is always the session account; the
// repository decides with the domain (canChangeShares, canShare) and
// applies the change in one transaction (checklist 4).
import { setShares } from '@mychess/db';
import type { ShareRefusal } from '@mychess/domain';
import { refresh } from 'next/cache';
import { getDb } from '../../../server/db';
import { requireOnboarded } from '../../../server/session';
import { parseShares } from '../../../server/share-input';

/** What the share form shows after a submit. */
export interface ShareState {
  /** A coach refused, or the whole request when nothing is shared. */
  readonly refusal?: ShareRefusal['reason'];
  /** How many coaches the repertoire is shared with now. */
  readonly shared?: number;
}

/**
 * Shares the owner's repertoire with exactly the checked coaches. Someone
 * else's repertoire changes nothing; a coach the owner is not linked to is
 * left out and said so.
 */
export async function setSharesAction(
  _previous: ShareState,
  form: FormData,
): Promise<ShareState> {
  const owner = await requireOnboarded();
  const request = parseShares(form);
  if (!request.ok) return { refusal: request.refusal.reason };
  const set = await setShares(getDb(), {
    ownerId: owner.id,
    ...request.value,
    now: new Date(),
  });
  if (!set.ok) return { refusal: set.refusal.reason };
  refresh();
  const { shared, refusal } = set.value;
  return refusal === undefined
    ? { shared }
    : { shared, refusal: refusal.reason };
}
