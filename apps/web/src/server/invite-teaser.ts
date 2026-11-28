import 'server-only';
import { inviteTeaser, type InviteTeaser } from '@mychess/db';
import { inviteTokenSchema } from '@mychess/domain';
import { inviteTokenOf } from '../lib/routes';
import { getDb } from './db';

/**
 * What sign-in and welcome may say about the invite in their return path
 * (R-235): a valid invite's coach and group, else null. The token is
 * checked for its format before any lookup, and is never logged or put in
 * an error. SECURITY.
 */
export async function teaserOf(
  next: string | null,
): Promise<InviteTeaser | null> {
  const token = inviteTokenSchema.safeParse(inviteTokenOf(next));
  if (!token.success) return null;
  return (await inviteTeaser(getDb(), token.data, new Date())) ?? null;
}
