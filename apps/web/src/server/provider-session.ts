import { providerSessionStands } from '@mychess/domain';
import type { BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { z } from 'zod';

type SessionHooks = NonNullable<
  NonNullable<BetterAuthOptions['databaseHooks']>['session']
>;
type AfterCreate = NonNullable<NonNullable<SessionHooks['create']>['after']>;

// Better Auth's provider callback, the one route where a provider's link
// opens a session; `id` names the provider.
const CALLBACK_PATH = '/callback/:id';

const callbackParams = z.object({ id: z.string() });
const createdSession = z.looseObject({
  token: z.string().min(1),
  userId: z.string().min(1),
});

/**
 * Better Auth's own code for a session it refused (a disabled account gets
 * it too); the sign-in page shows the general message for it.
 */
const SESSION_REFUSED = 'unable_to_create_session';

/**
 * Better Auth's hook after a session is written: a session a provider
 * callback opened stands only while that provider's link to the account
 * does (#272). A proof of the email (R-87) or an unlink can end the link
 * after the callback found it; the callback would then open a session the
 * proof never ended, so this one ends it and the sign-in fails as any
 * refused session does.
 *
 * It looks after the write, not before: a proof deletes the links before
 * the sessions, so either this read misses the link, or the proof's session
 * deletion comes after this session was written and ends it.
 */
export const endUnlinkedProviderSession: AfterCreate = async (session, ctx) => {
  if (ctx?.path !== CALLBACK_PATH) return;
  const provider = callbackParams.parse(ctx.params).id;
  const { token, userId } = createdSession.parse(session);
  const { internalAdapter } = ctx.context;
  const links = await internalAdapter.findAccounts(userId);
  const linked = links.map((link) => link.providerId);
  if (providerSessionStands(provider, linked)) return;
  await internalAdapter.deleteSession(token);
  throw new APIError('UNAUTHORIZED', {
    code: SESSION_REFUSED,
    message: SESSION_REFUSED,
  });
};
