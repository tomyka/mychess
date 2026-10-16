import { useTestDatabase } from '@mychess/db/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LICHESS_EMAIL_IN_USE } from '../../src/server/auth';
import {
  BASE,
  buildTestAuth,
  type BuiltAuth,
  cookieFrom,
  signInByMagicLink,
} from './support/auth';

const { db, client } = useTestDatabase();
const rows = async (sql: string): Promise<unknown[]> => {
  const result = await client.query<Record<string, unknown>>(sql);
  return result.rows;
};

const LICHESS = { id: 'ruta', username: 'Ruta', email: 'ruta@example.lt' };

// Lichess's token and identity endpoints, as `fetch` would reach them.
function fakeLichess(input: string | URL | Request): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();
  if (url === 'https://lichess.org/api/token')
    return Promise.resolve(
      Response.json({
        access_token: 'l-at',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    );
  if (url === 'https://lichess.org/api/account')
    return Promise.resolve(Response.json(LICHESS));
  if (url === 'https://lichess.org/api/account/email')
    return Promise.resolve(Response.json({ email: LICHESS.email }));
  return Promise.reject(new Error(`unexpected fetch ${url}`));
}

const startAnswer = z.object({ url: z.string() });

// A Lichess sign-in, or with `signedIn` a link from settings, through to
// the callback Lichess would redirect to.
async function lichessRoundTrip(
  built: BuiltAuth,
  signedIn?: string,
): Promise<Response> {
  const path = signedIn === undefined ? 'sign-in/social' : 'link-social';
  const start = await built.auth.handler(
    new Request(`${BASE}/api/auth/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        cookie: signedIn ?? '',
      },
      body: JSON.stringify({ provider: 'lichess', callbackURL: '/' }),
    }),
  );
  const { url } = startAnswer.parse(await start.json());
  const state = new URL(url).searchParams.get('state') ?? '';
  const cookie = [signedIn, cookieFrom(start)].filter(Boolean).join('; ');
  return built.auth.handler(
    new Request(`${BASE}/api/auth/callback/lichess?code=fake&state=${state}`, {
      headers: { cookie },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Task 9 moves these into oauth.test.ts.
describe('Lichess under the Better Auth configuration', () => {
  it('refuses a Lichess sign-in whose email already has an account, with its own code', async () => {
    vi.stubGlobal('fetch', fakeLichess);
    const built = buildTestAuth(db, fakeLichess);
    await signInByMagicLink(built, 'ruta@example.lt');
    const response = await lichessRoundTrip(built);
    expect(
      new URL(response.headers.get('location') ?? '', BASE).searchParams.get(
        'error',
      ),
    ).toBe(LICHESS_EMAIL_IN_USE);
    expect(
      await rows('select count(*)::int as n from provider_accounts'),
    ).toEqual([{ n: 0 }]);
  });

  it('creates a new account from a Lichess sign-in, its token encrypted', async () => {
    vi.stubGlobal('fetch', fakeLichess);
    const built = buildTestAuth(db, fakeLichess);
    await lichessRoundTrip(built);
    expect(await rows('select email, display_name from accounts')).toEqual([
      { email: 'ruta@example.lt', display_name: 'Ruta' },
    ]);
    const links = await rows(
      'select provider_id, provider_account_id, access_token from provider_accounts',
    );
    expect(links).toMatchObject([
      { provider_id: 'lichess', provider_account_id: 'ruta' },
    ]);
    const [link] = z.array(z.object({ access_token: z.string() })).parse(links);
    expect(link?.access_token).not.toBe('l-at');
  });

  it('links Lichess from settings while signed in, even with the same email', async () => {
    vi.stubGlobal('fetch', fakeLichess);
    const built = buildTestAuth(db, fakeLichess);
    const cookie = await signInByMagicLink(built, 'ruta@example.lt');
    const response = await lichessRoundTrip(built, cookie);
    expect(response.headers.get('location')).toBe('/');
    expect(
      await rows(
        'select a.email, p.provider_id from provider_accounts p join accounts a on a.id = p.account_id',
      ),
    ).toEqual([{ email: 'ruta@example.lt', provider_id: 'lichess' }]);
  });
});
