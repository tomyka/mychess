import { describe, expect, it, vi } from 'vitest';
import { lichessUserInfo } from './lichess';

const href = (input: string | URL | Request) =>
  input instanceof Request ? input.url : input.toString();

const answers = (account: unknown, email: unknown) =>
  vi.fn<typeof fetch>((url) =>
    Promise.resolve(
      Response.json(href(url).endsWith('/api/account/email') ? email : account),
    ),
  );

describe('lichessUserInfo', () => {
  it('maps the Lichess id, username and email, never claiming the email verified', async () => {
    const fetch = answers(
      { id: 'ruta', username: 'Ruta' },
      { email: 'ruta@example.lt' },
    );
    const info = await lichessUserInfo(fetch)({ accessToken: 'tok' });
    expect(info).toEqual({
      id: 'ruta',
      name: 'Ruta',
      email: 'ruta@example.lt',
      emailVerified: false,
    });
    const headers = { authorization: 'Bearer tok' };
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.headers])).toEqual(
      [
        ['https://lichess.org/api/account', headers],
        ['https://lichess.org/api/account/email', headers],
      ],
    );
  });

  it('refuses an account Lichess gives no email for', async () => {
    expect(
      await lichessUserInfo(answers({ id: 'r', username: 'R' }, {}))({
        accessToken: 't',
      }),
    ).toBeNull();
  });

  it('refuses an answer without a Lichess id', async () => {
    expect(
      await lichessUserInfo(answers({ username: 'R' }, { email: 'r@e.lt' }))({
        accessToken: 't',
      }),
    ).toBeNull();
  });

  it('refuses when Lichess answers with an error', async () => {
    const failing = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('no', { status: 401 })),
    );
    expect(await lichessUserInfo(failing)({ accessToken: 't' })).toBeNull();
  });

  it('refuses when Lichess answers with something that is not JSON', async () => {
    const garbled = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('<html>busy</html>', { status: 200 })),
    );
    expect(await lichessUserInfo(garbled)({ accessToken: 't' })).toBeNull();
  });

  it('refuses when Lichess cannot be reached in time', async () => {
    const timedOut = vi.fn<typeof fetch>(() =>
      Promise.reject(new DOMException('timed out', 'TimeoutError')),
    );
    expect(await lichessUserInfo(timedOut)({ accessToken: 't' })).toBeNull();
  });

  it('gives up on a Lichess call after ten seconds', async () => {
    const fetch = answers({ id: 'r', username: 'R' }, { email: 'r@e.lt' });
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await lichessUserInfo(fetch)({ accessToken: 't' });
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(
      fetch.mock.calls.map(([, init]) => init?.signal instanceof AbortSignal),
    ).toEqual([true, true]);
    timeout.mockRestore();
  });

  it('refuses without an access token, asking Lichess nothing', async () => {
    const fetch = answers({}, {});
    expect(await lichessUserInfo(fetch)({})).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
