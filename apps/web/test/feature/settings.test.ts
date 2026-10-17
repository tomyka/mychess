import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  deleteAccountAction,
  dismissLichessUnlinkedAction,
  updateProfileAction,
} from '../../src/app/nustatymai/actions';
import { showLichessUnlinked } from '../../src/server/lichess-unlinked';
import { deletedMail } from '../../src/server/mail';
import { linkedProviders } from '../../src/server/provider-links';
import { BASE, requestMagicLink } from './support/auth';
import {
  onboarded,
  rebuildAuth,
  signIn,
  useRequestHarness,
} from './support/harness';
import {
  errorCode,
  fakeProviderFetch,
  oauthRoundTrip,
  startOAuth,
} from './support/oauth';
import { built, outcomeOf, request } from './support/request';

vi.mock('next/headers', async () =>
  (await import('./support/request')).nextHeaders(),
);
vi.mock('next/navigation', async () =>
  (await import('./support/request')).nextNavigation(),
);
vi.mock('next/cache', async () =>
  (await import('./support/request')).nextCache(),
);
vi.mock('../../src/server/db', async () =>
  (await import('./support/request')).serverDb(),
);
vi.mock('../../src/server/auth', async (original) =>
  (await import('./support/request')).serverAuth(original),
);

const { client, sql } = useRequestHarness();

const RUTA = 'ruta@example.lt';
const JONAS = 'jonas@example.lt';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const idRows = z.array(z.object({ id: z.string() }));

function profileForm(displayName: string, locale: string): FormData {
  const data = new FormData();
  data.set('displayName', displayName);
  data.set('locale', locale);
  return data;
}

function deleteForm(confirmation: string): FormData {
  const data = new FormData();
  data.set('confirmation', confirmation);
  return data;
}

async function storedProfiles(): Promise<unknown> {
  const { rows } = await client.query(
    'select email, display_name as "displayName", locale from accounts order by email',
  );
  return rows;
}

describe('updateProfileAction', () => {
  it('stores the new name and language, remembers the language and refreshes the page', async () => {
    request.cookie = await onboarded(RUTA, 'Rūta');
    expect(
      await outcomeOf(updateProfileAction({}, profileForm(' Rūta J ', 'en'))),
    ).toEqual({ saved: true });
    expect(await storedProfiles()).toEqual([
      { email: RUTA, displayName: 'Rūta J', locale: 'en' },
    ]);
    expect(request.set).toEqual([
      {
        name: 'NEXT_LOCALE',
        value: 'en',
        options: { path: '/', maxAge: 31_536_000, sameSite: 'lax' },
      },
    ]);
    expect(request.refreshed).toBe(1);
  });

  it('leaves the locale cookie alone when the language stays', async () => {
    request.cookie = await onboarded(RUTA, 'Rūta');
    expect(
      await outcomeOf(updateProfileAction({}, profileForm('Rūta J', 'lt'))),
    ).toEqual({ saved: true });
    expect(await storedProfiles()).toEqual([
      { email: RUTA, displayName: 'Rūta J', locale: 'lt' },
    ]);
    expect(request.set).toEqual([]);
  });

  it('refuses a blank name and stores nothing', async () => {
    request.cookie = await onboarded(RUTA, 'Rūta');
    expect(
      await outcomeOf(updateProfileAction({}, profileForm('   ', 'en'))),
    ).toEqual({ refusal: 'displayName.blank' });
    expect(await storedProfiles()).toEqual([
      { email: RUTA, displayName: 'Rūta', locale: 'lt' },
    ]);
    expect(request.set).toEqual([]);
    expect(request.refreshed).toBe(0);
  });

  it('sends an account that has not been through onboarding there first', async () => {
    request.cookie = await signIn(RUTA);
    expect(
      await outcomeOf(updateProfileAction({}, profileForm('Rūta', 'en'))),
    ).toEqual({ redirectedTo: '/pradzia' });
    expect(await storedProfiles()).toEqual([
      { email: RUTA, displayName: '', locale: 'lt' },
    ]);
  });

  it('sends a signed-out visitor to sign-in', async () => {
    expect(
      await outcomeOf(updateProfileAction({}, profileForm('Rūta', 'en'))),
    ).toEqual({ redirectedTo: '/prisijungti' });
  });
});

// The rows that belong to `email`'s account, table by table.
async function rowsOf(email: string): Promise<Record<string, number>> {
  const { rows } = await client.query(
    `select
       (select count(*)::int from accounts where email = $1) as accounts,
       (select count(*)::int from sessions s join accounts a on a.id = s.account_id
          where a.email = $1) as sessions,
       (select count(*)::int from provider_accounts p
          join accounts a on a.id = p.account_id where a.email = $1)
          as "providerAccounts",
       (select count(*)::int from verifications
          where value like '%' || $1 || '%') as verifications`,
    [email],
  );
  return z.array(z.record(z.string(), z.number())).parse(rows)[0] ?? {};
}

/**
 * Mails a magic link to `email` and leaves it unused; from its own address,
 * so the sign-ins around it stay under the magic-link rate limit.
 */
async function pendingMagicLink(email: string): Promise<void> {
  await requestMagicLink(
    built(),
    { email, callbackURL: '/' },
    { 'x-real-ip': '203.0.113.7' },
  );
}

/**
 * Jonas, onboarded with a magic link pending; then Rūta, signed in now,
 * onboarded in English, with Lichess linked and a magic link pending.
 * Returns Jonas's session cookie.
 */
async function twoAccounts(): Promise<string> {
  const fetch = fakeProviderFetch({
    lichess: { id: 'ruta', username: 'Ruta', email: 'lichess@example.lt' },
  });
  vi.stubGlobal('fetch', fetch);
  rebuildAuth({ fetch });
  const jonas = await onboarded(JONAS, 'Jonas');
  await pendingMagicLink(JONAS);
  request.cookie = await onboarded(RUTA, 'Rūta Jonaitė', 'en');
  await oauthRoundTrip(built(), 'lichess', {
    cookie: request.cookie,
    link: true,
  });
  await pendingMagicLink(RUTA);
  return jonas;
}

/** Did the action expire this browser's session cookie? */
function sessionCookieCleared(): boolean {
  const cookie = request.set.find(
    (c) => c.name === 'better-auth.session_token',
  );
  return cookie?.value === '' && cookie.options['maxAge'] === 0;
}

describe('deleteAccountAction', () => {
  it('refuses a typed name that is not the display name and deletes nothing (R-82)', async () => {
    await twoAccounts();
    const before = await rowsOf(RUTA);
    expect(
      await outcomeOf(deleteAccountAction({}, deleteForm('Rūta'))),
    ).toEqual({ refusal: 'account.deleteNameMismatch' });
    expect(await rowsOf(RUTA)).toEqual(before);
    expect(before).toEqual({
      accounts: 1,
      sessions: 1,
      providerAccounts: 1,
      verifications: 1,
    });
    expect(request.mailed).toEqual([]);
    expect(request.set).toEqual([]);
  });

  it('deletes everything of the account, mails it in its language, signs the browser out and says so (R-40, R-82)', async () => {
    await twoAccounts();
    const jonasBefore = await rowsOf(JONAS);
    expect(
      await outcomeOf(deleteAccountAction({}, deleteForm(' Rūta Jonaitė '))),
    ).toEqual({ redirectedTo: '/prisijungti?deleted=1' });
    expect(await rowsOf(RUTA)).toEqual({
      accounts: 0,
      sessions: 0,
      providerAccounts: 0,
      verifications: 0,
    });
    expect(await sql.count('provider_accounts')).toBe(0);
    expect(await rowsOf(JONAS)).toEqual(jonasBefore);
    expect(jonasBefore).toMatchObject({ accounts: 1, sessions: 1 });
    expect(request.mailed).toEqual([deletedMail('en', RUTA)]);
    expect(sessionCookieCleared()).toBe(true);
  });

  it('still deletes and signs out when the mail cannot be sent, logging no address', async () => {
    request.cookie = await onboarded(RUTA, 'Rūta');
    request.mailFails = true;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {
      // the expected failure is asserted below
    });
    expect(
      await outcomeOf(deleteAccountAction({}, deleteForm('Rūta'))),
    ).toEqual({ redirectedTo: '/prisijungti?deleted=1' });
    expect(await sql.count('accounts')).toBe(0);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls)).toContain('mail: down');
    expect(String(logged.mock.calls)).not.toContain(RUTA);
    expect(sessionCookieCleared()).toBe(true);
  });

  it('sends a signed-out visitor to sign-in', async () => {
    await onboarded(RUTA, 'Rūta');
    expect(
      await outcomeOf(deleteAccountAction({}, deleteForm('Rūta'))),
    ).toEqual({ redirectedTo: '/prisijungti' });
    expect(await sql.count('accounts')).toBe(1);
  });

  // Not through onboarding yet: no name of its own, so it confirms with its
  // email instead (R-86); a blank name typed blank never matches.
  it.each([
    ['nothing', ''],
    ['another address', JONAS],
    ['the name', 'Ruta'],
  ])(
    'refuses an account not yet onboarded that types %s, deleting nothing',
    async (_, typed) => {
      request.cookie = await signIn(RUTA);
      const before = await rowsOf(RUTA);
      expect(
        await outcomeOf(deleteAccountAction({}, deleteForm(typed))),
      ).toEqual({ refusal: 'account.deleteEmailMismatch' });
      expect(await rowsOf(RUTA)).toEqual(before);
      expect(before).toMatchObject({ accounts: 1, sessions: 1 });
      expect(request.mailed).toEqual([]);
      expect(request.set).toEqual([]);
    },
  );

  it('deletes an account not yet onboarded once its email is typed, in any case (R-86)', async () => {
    request.cookie = await signIn(RUTA);
    expect(
      await outcomeOf(deleteAccountAction({}, deleteForm(' Ruta@Example.LT '))),
    ).toEqual({ redirectedTo: '/prisijungti?deleted=1' });
    expect(await rowsOf(RUTA)).toMatchObject({ accounts: 0, sessions: 0 });
    expect(request.mailed).toEqual([deletedMail('lt', RUTA)]);
    expect(sessionCookieCleared()).toBe(true);
  });

  // An account a Lichess sign-up created names an address nobody proved:
  // mychess does not mail it (R-87).
  it('deletes an account whose email was never proven without mailing it', async () => {
    request.cookie = await onboarded(RUTA, 'Rūta');
    await client.query('update accounts set email_verified = false');
    expect(
      await outcomeOf(deleteAccountAction({}, deleteForm('Rūta'))),
    ).toEqual({ redirectedTo: '/prisijungti?deleted=1' });
    expect(await sql.count('accounts')).toBe(0);
    expect(request.mailed).toEqual([]);
    expect(sessionCookieCleared()).toBe(true);
  });
});

/** Unlinks `accountId` through Better Auth, as the settings page does. */
function unlink(accountIdToUnlink: string): Promise<Response> {
  return built().auth.handler(
    new Request(`${BASE}/api/auth/unlink-account`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        cookie: request.cookie,
      },
      body: JSON.stringify({ accountId: accountIdToUnlink }),
    }),
  );
}

describe('the provider links on settings', () => {
  it('lists none for an account signed in by email', async () => {
    request.cookie = await onboarded(RUTA, 'Rūta');
    expect(await linkedProviders()).toEqual([]);
  });

  it('lists a Lichess link by its row id, which unlinking takes (decision 6)', async () => {
    await twoAccounts();
    const { rows } = await client.query(
      `select p.id from provider_accounts p join accounts a
         on a.id = p.account_id where a.email = $1`,
      [RUTA],
    );
    const [row] = idRows.parse(rows);
    expect(await linkedProviders()).toEqual([
      { id: row?.id, provider: 'lichess' },
    ]);
    const response = await unlink(row?.id ?? '');
    expect(response.status).toBe(200);
    expect(await sql.count('provider_accounts')).toBe(0);
    // Unlinked by hand: no notice that it was done for security (R-90).
    expect(response.headers.getSetCookie().join()).not.toContain(
      'lichess_unlinked',
    );
    expect(await linkedProviders()).toEqual([]);
  });

  it('refuses to unlink from a session older than a day', async () => {
    await twoAccounts();
    await client.query(
      "update sessions set created_at = now() - interval '25 hours'",
    );
    const [link] = await linkedProviders();
    const response = await unlink(link?.id ?? '');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'SESSION_NOT_FRESH' });
    expect(await sql.count('provider_accounts')).toBe(1);
  });

  it('refuses to start a link from a session older than a day', async () => {
    request.cookie = await onboarded(RUTA, 'Rūta');
    await client.query(
      "update sessions set created_at = now() - interval '25 hours'",
    );
    const response = await startOAuth(built(), 'lichess', {
      cookie: request.cookie,
      link: true,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'SESSION_NOT_FRESH' });
    expect(await sql.count('provider_accounts')).toBe(0);
  });

  it('starts a link from a session younger than a day', async () => {
    request.cookie = await onboarded(RUTA, 'Rūta');
    await client.query(
      "update sessions set created_at = now() - interval '23 hours'",
    );
    const response = await startOAuth(built(), 'lichess', {
      cookie: request.cookie,
      link: true,
    });
    expect(response.status).toBe(200);
  });

  it('cannot unlink another account’s link', async () => {
    const jonas = await twoAccounts();
    const [link] = await linkedProviders();
    request.cookie = jonas;
    const response = await unlink(link?.id ?? '');
    expect(response.status).toBe(400);
    expect(await sql.count('provider_accounts')).toBe(1);
  });

  it('sends a link that another account holds back to settings with its code', async () => {
    const jonas = await twoAccounts();
    const response = await oauthRoundTrip(built(), 'lichess', {
      cookie: jonas,
      link: true,
      body: { callbackURL: '/nustatymai', errorCallbackURL: '/nustatymai' },
    });
    const location = new URL(response.headers.get('location') ?? '', BASE);
    expect(location.pathname).toBe('/nustatymai');
    expect(errorCode(response)).toBe(
      'account_already_linked_to_different_user',
    );
    expect(await sql.count('provider_accounts')).toBe(1);
  });

  it('lists nothing for a signed-out visitor', async () => {
    expect(await linkedProviders()).toEqual([]);
  });
});

// Proving the email ended an unproven account's Lichess link: settings says
// so, until Lichess is connected again or the notice is dismissed (R-90).
describe('the Lichess-disconnected notice', () => {
  /**
   * Rūta's address signed up with Lichess, then proven by magic link, so
   * the Lichess link ended; returns the owner's cookie with the notice.
   */
  async function provenAfterLichess(): Promise<string> {
    const fetch = fakeProviderFetch({
      lichess: { id: 'ruta', username: 'Ruta', email: RUTA },
    });
    vi.stubGlobal('fetch', fetch);
    rebuildAuth({ fetch });
    await oauthRoundTrip(built(), 'lichess');
    return signIn(RUTA);
  }

  const shown = async (): Promise<boolean> =>
    showLichessUnlinked(await sql.accountId(RUTA), await linkedProviders());

  it('is shown to the account whose Lichess link the proof ended', async () => {
    request.cookie = await provenAfterLichess();
    expect(request.cookie).toContain('mychess.lichess_unlinked=');
    expect(await shown()).toBe(true);
  });

  it('is not shown to another account signed in on the same browser', async () => {
    const notice = (await provenAfterLichess())
      .split('; ')
      .filter((c) => c.startsWith('mychess.lichess_unlinked='));
    request.cookie = [await onboarded(JONAS, 'Jonas'), ...notice].join('; ');
    expect(
      await showLichessUnlinked(
        await sql.accountId(JONAS),
        await linkedProviders(),
      ),
    ).toBe(false);
  });

  it('is not shown without the notice cookie', async () => {
    request.cookie = await onboarded(RUTA, 'Rūta');
    expect(await shown()).toBe(false);
  });

  it('is not shown once Lichess is connected again', async () => {
    request.cookie = await provenAfterLichess();
    await oauthRoundTrip(built(), 'lichess', {
      cookie: request.cookie,
      link: true,
    });
    expect(await linkedProviders()).toMatchObject([{ provider: 'lichess' }]);
    expect(await shown()).toBe(false);
  });

  it('is dismissed: the cookie goes and the page refreshes', async () => {
    request.cookie = await provenAfterLichess();
    await dismissLichessUnlinkedAction();
    expect(request.set).toEqual([
      {
        name: 'mychess.lichess_unlinked',
        value: '',
        options: { deleted: true },
      },
    ]);
    expect(request.refreshed).toBe(1);
  });
});
