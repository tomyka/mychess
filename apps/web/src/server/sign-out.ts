import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';
import { cookies, headers } from 'next/headers';
import { getAuth } from './auth';

/**
 * Ends this request's session and expires its cookies in the browser, from
 * a server action. The cookies Better Auth's sign-out answers with are set
 * on the action's own response here rather than left to the nextCookies
 * plugin alone, so the sign-out does not hang on a plugin's side effect.
 */
export async function signOutHere(): Promise<void> {
  const answer = await getAuth().api.signOut({
    headers: await headers(),
    returnHeaders: true,
  });
  const store = await cookies();
  const expired = parseSetCookieHeader(answer.headers.get('set-cookie') ?? '');
  expired.forEach((attributes, name) => {
    store.set(name, attributes.value, toCookieOptions(attributes));
  });
}
