'use server';

import { acceptInvite, inviteTokenHash } from '@mychess/db';
import {
  INVITE_REFUSALS,
  inviteTokenSchema,
  type InviteRefusal,
} from '@mychess/domain';
import { redirect } from 'next/navigation';
import { ROUTES } from '../../../lib/routes';
import { getDb } from '../../../server/db';
import { requireOnboarded } from '../../../server/session';

/** What the confirm screen shows after Accept: a refusal, if any. */
export interface AcceptState {
  readonly refusal?: InviteRefusal['reason'];
}

/**
 * Accepts the invite as the session account, never an id the form carries
 * (checklist 4), and only on a POST (plan decision 8). The token is
 * checked for its format before it is hashed (plan decision 6). On
 * success the player lands on "Mano treneriai" (plan decision 12).
 */
export async function acceptInviteAction(
  _previous: AcceptState,
  form: FormData,
): Promise<AcceptState> {
  const player = await requireOnboarded();
  const token = inviteTokenSchema.safeParse(form.get('token'));
  if (!token.success) return { refusal: INVITE_REFUSALS.invalid };
  const accepted = await acceptInvite(
    getDb(),
    inviteTokenHash(token.data),
    player.id,
    new Date(),
  );
  if (!accepted.ok) return { refusal: accepted.refusal.reason };
  redirect(ROUTES.myCoaches);
}
