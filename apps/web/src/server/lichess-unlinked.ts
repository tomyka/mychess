import {
  leavesLichessNotice,
  showsLichessNotice,
  type LinkEnd,
  type Provider,
} from '@mychess/domain';
import type { BetterAuthOptions } from 'better-auth';
import { cookies } from 'next/headers';
import { z } from 'zod';

/** The browser's note that proving the email ended a Lichess link (R-90). */
const LICHESS_UNLINKED_COOKIE = 'mychess.lichess_unlinked';

// As long as a sign-in lasts (R-80): the note waits for a visit to settings.
const NOTE_SECONDS = 90 * 24 * 60 * 60;

// The requests that prove an email and end an unproven account's access:
// a magic link, and a Google sign-in (R-87). Any other deletion is an
// unlink from settings, the person's own doing.
const PROOF_PATHS = new Set(['/magic-link/verify', '/callback/:id']);

const endedBy = (path: string): LinkEnd =>
  PROOF_PATHS.has(path) ? 'proof' : 'unlink';

const deletedLink = z.looseObject({
  providerId: z.string(),
  userId: z.string().min(1),
});

type AccountHooks = NonNullable<
  NonNullable<BetterAuthOptions['databaseHooks']>['account']
>;
type BeforeDelete = NonNullable<NonNullable<AccountHooks['delete']>['before']>;

/**
 * Better Auth's hook before a provider link is deleted: when the domain says
 * the deletion leaves the Lichess-disconnected notice (a proof of the email
 * ending a Lichess link), leaves the browser a note naming the account, so
 * settings can say why Lichess is gone (R-90).
 */
export const noteLichessUnlinked: BeforeDelete = (link, ctx) => {
  const row = deletedLink.safeParse(link);
  if (ctx === null || !row.success) return Promise.resolve();
  if (!leavesLichessNotice(row.data.providerId, endedBy(ctx.path)))
    return Promise.resolve();
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
 * security (R-90)? The domain decides from this browser's note and the
 * account's provider links.
 */
export async function showLichessUnlinked(
  accountId: string,
  links: readonly { readonly provider: Provider }[],
): Promise<boolean> {
  const note = (await cookies()).get(LICHESS_UNLINKED_COOKIE)?.value;
  return showsLichessNotice({
    noticeFor: note,
    accountId,
    linkedProviders: links.map((link) => link.provider),
  });
}

/** Drops this browser's note once the person has read it. */
export async function forgetLichessUnlinked(): Promise<void> {
  (await cookies()).delete(LICHESS_UNLINKED_COOKIE);
}
