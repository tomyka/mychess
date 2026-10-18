import { inviteTokenSchema } from '@mychess/domain';
import { ROUTES } from './routes';

const INVITE_PREFIX = '/k/';

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
  next === null ? page : `${page}?next=${encodeURIComponent(next)}`;

/** The sign-in page, carrying a kept return path as `?next=`. */
export const signInPath = (next: string | null): string =>
  withNext(ROUTES.signIn, next);

/** The onboarding page, carrying a kept return path as `?next=`. */
export const onboardingPath = (next: string | null): string =>
  withNext(ROUTES.onboarding, next);
