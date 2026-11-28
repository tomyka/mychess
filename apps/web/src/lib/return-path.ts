import { inviteTokenSchema } from '@mychess/domain';
import { firstValue, ROUTES, type SearchParams } from './routes';

const INVITE_PREFIX = '/invite/';

/** The query parameter sign-in and onboarding carry a return path in. */
const NEXT_PARAM = 'next';

/**
 * Where to send a person back to after sign-in or onboarding (R-81): only
 * an invite page with a well-formed token. Anything else is null, so no
 * `?next=` can send a browser off the site or to a page we did not mean.
 * An allowlist, not a sanitiser (plan decision 7).
 */
export function returnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith(INVITE_PREFIX)) return null;
  return inviteTokenSchema.safeParse(raw.slice(INVITE_PREFIX.length)).success
    ? raw
    : null;
}

const withNext = (page: string, next: string | null): string =>
  next === null ? page : `${page}?${NEXT_PARAM}=${encodeURIComponent(next)}`;

/** The sign-in page, carrying a kept return path as `?next=`. */
export const signInPath = (next: string | null): string =>
  withNext(ROUTES.signIn, next);

/** The onboarding page, carrying a kept return path as `?next=`. */
export const onboardingPath = (next: string | null): string =>
  withNext(ROUTES.onboarding, next);

/** The sign-in page's query parameters besides `?next=`. */
const SIGN_IN_PARAMS = { error: 'error', deleted: 'deleted' } as const;

/** A kept return path from a page's `?next=` (its first value), or null. */
const nextOf = (params: SearchParams): string | null =>
  returnPath(firstValue.parse(params[NEXT_PARAM]));

/**
 * The sign-in page's query (#402): the kept return path; the reason a
 * sign-in failed, as Better Auth sends it back (`?error=`); and whether an
 * account was just deleted (`?deleted=1`). The first value of each.
 */
export const readSignInQuery = (
  params: SearchParams,
): {
  readonly next: string | null;
  readonly error: string | undefined;
  readonly deleted: boolean;
} => ({
  next: nextOf(params),
  error: firstValue.parse(params[SIGN_IN_PARAMS.error]),
  deleted: firstValue.parse(params[SIGN_IN_PARAMS.deleted]) === '1',
});

/** The onboarding page's query (#402): the kept return path. */
export const readOnboardingQuery = (
  params: SearchParams,
): { readonly next: string | null } => ({ next: nextOf(params) });
