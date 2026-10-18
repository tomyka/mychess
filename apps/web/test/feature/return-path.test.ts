import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeOnboardingAction } from '../../src/app/pradzia/actions';
import SignInPage from '../../src/app/prisijungti/page';
import { BASE, mailedLink, requestMagicLink } from './support/auth';
import {
  onboarded,
  rebuildAuth,
  signIn,
  useRequestHarness,
} from './support/harness';
import { fakeProviderFetch, oauthRoundTrip } from './support/oauth';
import { built, outcomeOf, request } from './support/request';

vi.mock('next/headers', async () =>
  (await import('./support/request')).nextHeaders(),
);
vi.mock('next/navigation', async () =>
  (await import('./support/request')).nextNavigation(),
);
vi.mock('../../src/server/db', async () =>
  (await import('./support/request')).serverDb(),
);
vi.mock('../../src/server/auth', async (original) =>
  (await import('./support/request')).serverAuth(original),
);

const { sql } = useRequestHarness();

afterEach(() => {
  vi.unstubAllGlobals();
});

const TOKEN = 'A'.repeat(42) + '_';
const INVITE = `/k/${TOKEN}`;
const VIA_ONBOARDING = `/pradzia?next=%2Fk%2F${TOKEN}`;
const RUTA = 'ruta@example.lt';

// Better Auth answers with absolute URLs; resolving against the site keeps
// a different host visible in the comparison.
const onSite = (path: string): string => new URL(path, BASE).href;
const landing = (response: Response): string =>
  new URL(response.headers.get('location') ?? '', BASE).href;

function onboardingForm(next: string): FormData {
  const data = new FormData();
  data.set('displayName', 'Rūta');
  data.set('locale', 'lt');
  data.set('next', next);
  return data;
}

const signInPage = (next: string): Promise<unknown> =>
  outcomeOf(SignInPage({ searchParams: Promise.resolve({ next }) }));

/** Requests a magic link back to the invite and follows it; where it lands. */
async function followMagicLink(email: string): Promise<string> {
  const asked = await requestMagicLink(built(), {
    email,
    callbackURL: INVITE,
    newUserCallbackURL: VIA_ONBOARDING,
  });
  expect(asked.status).toBe(200);
  const link = mailedLink(built());
  if (link === undefined) throw new Error('no magic link was mailed');
  return landing(await built().auth.handler(new Request(link)));
}

describe('completeOnboardingAction with a return path (R-81)', () => {
  it('goes on to the invite', async () => {
    request.cookie = await signIn(RUTA);
    expect(
      await outcomeOf(completeOnboardingAction({}, onboardingForm(INVITE))),
    ).toEqual({ redirectedTo: INVITE });
    expect(
      await sql.rows('select onboarded_at is not null as done from accounts'),
    ).toEqual([{ done: true }]);
  });

  it('goes home for a return path off the site', async () => {
    request.cookie = await signIn(RUTA);
    expect(
      await outcomeOf(
        completeOnboardingAction({}, onboardingForm('//evil.example')),
      ),
    ).toEqual({ redirectedTo: '/' });
  });

  it('sends an already onboarded account on to the invite', async () => {
    request.cookie = await onboarded(RUTA, 'Rūta');
    expect(
      await outcomeOf(completeOnboardingAction({}, onboardingForm(INVITE))),
    ).toEqual({ redirectedTo: INVITE });
  });
});

describe('the sign-in page with a return path', () => {
  it('sends a signed-in account on to the invite', async () => {
    request.cookie = await signIn(RUTA);
    expect(await signInPage(INVITE)).toEqual({ redirectedTo: INVITE });
  });

  it('sends a signed-in account home for a return path off the site', async () => {
    request.cookie = await signIn(RUTA);
    expect(await signInPage('https://evil.example')).toEqual({
      redirectedTo: '/',
    });
  });
});

describe('Better Auth keeps the return path', () => {
  it('sends a new magic-link account through onboarding to the invite', async () => {
    expect(await followMagicLink(RUTA)).toBe(onSite(VIA_ONBOARDING));
  });

  it('sends an existing magic-link account straight to the invite', async () => {
    await signIn(RUTA);
    expect(await followMagicLink(RUTA)).toBe(onSite(INVITE));
  });

  it('sends a new Google identity through onboarding, a returning one to the invite (G-M1-1)', async () => {
    const fetch = fakeProviderFetch({
      google: {
        sub: 'g-1',
        email: 'gabija@example.lt',
        email_verified: true,
        name: 'Gabija',
      },
    });
    vi.stubGlobal('fetch', fetch);
    rebuildAuth({ fetch });
    const body = { callbackURL: INVITE, newUserCallbackURL: VIA_ONBOARDING };
    const first = await oauthRoundTrip(built(), 'google', { body });
    expect(landing(first)).toBe(onSite(VIA_ONBOARDING));
    const again = await oauthRoundTrip(built(), 'google', { body });
    expect(landing(again)).toBe(onSite(INVITE));
  });

  it('refuses a mailed link whose callback was changed to another site, and signs nobody in', async () => {
    const asked = await requestMagicLink(built(), {
      email: RUTA,
      callbackURL: INVITE,
      newUserCallbackURL: VIA_ONBOARDING,
    });
    expect(asked.status).toBe(200);
    const link = mailedLink(built());
    if (link === undefined) throw new Error('no magic link was mailed');
    const tampered = new URL(link);
    tampered.searchParams.set('callbackURL', 'https://evil.example/');
    const opened = await built().auth.handler(new Request(tampered));
    expect(opened.status).toBe(403);
    expect(opened.headers.get('location')).toBeNull();
    expect(opened.headers.get('set-cookie')).toBeNull();
    expect(await sql.count('sessions')).toBe(0);
    expect(await sql.count('accounts')).toBe(0);
  });

  it('refuses a callback off the site and mails nothing', async () => {
    const asked = await requestMagicLink(built(), {
      email: RUTA,
      callbackURL: 'https://evil.example/',
    });
    expect(asked.status).toBe(403);
    expect(built().sent).toEqual([]);
  });
});
