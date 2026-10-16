import type { BetterAuthOptions } from 'better-auth';
import { cookies } from 'next/headers';
import { z } from 'zod';
import type { Provider } from '../lib/providers';

/** The browser's note that proving the email ended a Lichess link (R-90). */
const LICHESS_UNLINKED_COOKIE = 'mychess.lichess_unlinked';

// As long as a sign-in lasts (R-80): the note waits for a visit to settings.
const NOTE_SECONDS = 90 * 24 * 60 * 60;

// The requests that prove an email and end an unproven account's access:
// a magic link, and a Google sign-in (R-87). An unlink from settings is
// the person's own doing and leaves no note.
const PROOF_PATHS = new Set(['/magic-link/verify', '/callback/:id']);

const deletedLink = z.looseObject({
  providerId: z.string(),
  userId: z.string().min(1),
});

type AccountHooks = NonNullable<
  NonNullable<BetterAuthOptions['databaseHooks']>['account']
>;
type BeforeDelete = NonNullable<NonNullable<AccountHooks['delete']>['before']>;

/**
 * Better Auth's hook before a provider link is deleted: when a proof of the
 * email deletes a Lichess link, leaves the browser a note naming the
 * account, so settings can say why Lichess is gone (R-90).
 */
export const noteLichessUnlinked: BeforeDelete = (link, ctx) => {
  const row = deletedLink.safeParse(link);
  if (ctx === null || !row.success || row.data.providerId !== 'lichess')
    return Promise.resolve();
  if (!PROOF_PATHS.has(ctx.path)) return Promise.resolve();
  ctx.setCookie(LICHESS_UNLINKED_COOKIE, row.data.userId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.context.authCookies.sessionToken.attributes.secure === true,
    maxAge: NOTE_SECONDS,
  });
  return Promise.resolve();
};

/**
 * Does settings tell `accountId` that Lichess was disconnected for its
 * security (R-90)? Only with this browser's note for this account, and
 * only while Lichess is not connected again.
 */
export async function showLichessUnlinked(
  accountId: string,
  links: readonly { readonly provider: Provider }[],
): Promise<boolean> {
  const note = (await cookies()).get(LICHESS_UNLINKED_COOKIE)?.value;
  return (
    note === accountId && !links.some((link) => link.provider === 'lichess')
  );
}

/** Drops this browser's note once the person has read it. */
export async function forgetLichessUnlinked(): Promise<void> {
  (await cookies()).delete(LICHESS_UNLINKED_COOKIE);
}
