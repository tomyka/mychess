import { z } from 'zod';
import { BASE, type BuiltAuth, cookieFrom } from './auth';

export interface FakeIdentity {
  google?: {
    sub: string;
    email: string;
    email_verified: boolean;
    name?: string;
  };
  lichess?: { id: string; username: string; email: string };
}

export type Provider = 'google' | 'lichess';

// An unsigned JWT carrying `claims`; Google's id token as its token endpoint returns it.
const idToken = (claims: object) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

const tokens = (accessToken: string, extra: object = {}) =>
  Response.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    ...extra,
  });

// What each provider endpoint answers for `who`, read when it is called,
// so a test can change the identity between round trips.
function answer(who: FakeIdentity, url: string): Response | undefined {
  if (url.startsWith('https://oauth2.googleapis.com/token'))
    return tokens('g-at', { id_token: idToken(who.google ?? {}) });
  if (url === 'https://lichess.org/api/token') return tokens('l-at');
  if (url === 'https://lichess.org/api/account')
    return Response.json(who.lichess ?? {});
  if (url === 'https://lichess.org/api/account/email')
    return Response.json({ email: who.lichess?.email });
  return undefined;
}

/**
 * A `fetch` that answers Google's and Lichess's token and identity
 * endpoints with `who` (no test reaches a real provider).
 */
export function fakeProviderFetch(who: FakeIdentity): typeof fetch {
  return (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    const response = answer(who, url);
    return response === undefined
      ? Promise.reject(new Error(`unexpected fetch ${url}`))
      : Promise.resolve(response);
  };
}

/** How a flow starts: as a sign-in or, with `link`, a link from settings. */
export interface StartOptions {
  /** The request's cookies, such as a signed-in session. */
  readonly cookie?: string;
  readonly link?: boolean;
  /** Fields added to the request body. */
  readonly body?: Record<string, unknown>;
}

/** Starts a sign-in with `provider`, or a link from settings. */
export function startOAuth(
  built: BuiltAuth,
  provider: Provider,
  opts: StartOptions = {},
): Promise<Response> {
  const path = opts.link === true ? 'link-social' : 'sign-in/social';
  return built.auth.handler(
    new Request(`${BASE}/api/auth/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        cookie: opts.cookie ?? '',
      },
      body: JSON.stringify({ provider, callbackURL: '/', ...opts.body }),
    }),
  );
}

/** A started flow: the state sent to the provider and the request's cookies. */
export interface StartedFlow {
  readonly provider: Provider;
  readonly state: string;
  readonly cookie: string;
}

const startAnswer = z.object({ url: z.string() });

/** Starts a flow as `startOAuth` does and keeps what its callback needs. */
export async function startedFlow(
  built: BuiltAuth,
  provider: Provider,
  opts: StartOptions = {},
): Promise<StartedFlow> {
  const start = await startOAuth(built, provider, opts);
  const { url } = startAnswer.parse(await start.json());
  return {
    provider,
    state: new URL(url).searchParams.get('state') ?? '',
    cookie: [opts.cookie, cookieFrom(start)].filter(Boolean).join('; '),
  };
}

/** Calls the callback the way the provider's redirect would after `flow`. */
export function oauthCallback(
  built: BuiltAuth,
  flow: StartedFlow,
): Promise<Response> {
  const { provider, state, cookie } = flow;
  return built.auth.handler(
    new Request(
      `${BASE}/api/auth/callback/${provider}?code=fake&state=${state}`,
      { headers: { cookie } },
    ),
  );
}

/**
 * A whole sign-in with `provider`, or a link from settings. Returns the
 * callback's response: its Location and cookies tell the outcome.
 */
export async function oauthRoundTrip(
  built: BuiltAuth,
  provider: Provider,
  opts: StartOptions = {},
): Promise<Response> {
  return oauthCallback(built, await startedFlow(built, provider, opts));
}

/** The `?error=` code a callback redirected with, or null. */
export function errorCode(response: Response): string | null {
  const location = response.headers.get('location') ?? '';
  return new URL(location, BASE).searchParams.get('error');
}
