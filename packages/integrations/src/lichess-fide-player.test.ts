import { describe, expect, it } from 'vitest';
import { FIDE_PLAYER_REFUSALS, lichessFidePlayer } from './lichess-fide-player';
import {
  fakeFetch,
  never,
  streamedResponse,
  trackedResponse,
} from './test-support';

const ID = 90000001;
const URL = `https://lichess.org/api/fide/player/${String(ID)}`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A synthetic player in the documented shape of the endpoint. */
const PLAYER = {
  id: ID,
  name: 'Testas, Jonas',
  federation: 'LTU',
  year: 1990,
  title: 'FM',
  standard: 2301,
  rapid: 2250,
  blitz: 2199,
  gender: 'M',
  photo: { small: 'https://example.org/s.webp', credit: 'Nobody' },
};

describe('lichessFidePlayer', () => {
  it('reads the name, federation, title and standard rating', async () => {
    const fetch = fakeFetch({ [URL]: json(PLAYER) });
    await expect(lichessFidePlayer(fetch, ID, never)).resolves.toEqual({
      ok: true,
      value: {
        name: 'Testas, Jonas',
        federation: 'LTU',
        title: 'FM',
        standardRating: 2301,
      },
    });
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]?.init.redirect).toBe('error');
  });

  it('reads a player without a title or a standard rating', async () => {
    const fetch = fakeFetch({
      [URL]: json({
        id: ID,
        name: 'Be, Titulo',
        federation: 'ZAM',
        year: null,
      }),
    });
    await expect(lichessFidePlayer(fetch, ID, never)).resolves.toEqual({
      ok: true,
      value: {
        name: 'Be, Titulo',
        federation: 'ZAM',
        title: null,
        standardRating: null,
      },
    });
  });

  it('refuses a player Lichess does not know', async () => {
    const fetch = fakeFetch({ [URL]: json({ error: 'Not found' }, 404) });
    await expect(lichessFidePlayer(fetch, ID, never)).resolves.toEqual({
      ok: false,
      refusal: { reason: FIDE_PLAYER_REFUSALS.notFound },
    });
  });

  it.each([
    ['text that is not JSON', new Response('<html>')],
    ['a missing name', json({ ...PLAYER, name: undefined })],
    ['a blank name', json({ ...PLAYER, name: '  ' })],
    ['a name with a control character', json({ ...PLAYER, name: 'A\u0000B' })],
    ['a name over 200 characters', json({ ...PLAYER, name: 'a'.repeat(201) })],
    ['a rating that is not a number', json({ ...PLAYER, standard: '2300' })],
    ['a negative rating', json({ ...PLAYER, standard: -1 })],
    [
      'a federation that is not three letters',
      json({ ...PLAYER, federation: 'Lithuania' }),
    ],
    ['an overlong title', json({ ...PLAYER, title: 'Grandmaster' })],
    ['another player', json({ ...PLAYER, id: ID + 1 })],
  ])('refuses an answer with %s', async (_, response) => {
    const fetch = fakeFetch({ [URL]: response });
    await expect(lichessFidePlayer(fetch, ID, never)).resolves.toEqual({
      ok: false,
      refusal: { reason: FIDE_PLAYER_REFUSALS.invalid },
    });
  });

  it('fails on an answer larger than 64 KB, counted while reading', async () => {
    const chunk = new TextEncoder().encode(' '.repeat(1024));
    const fetch = fakeFetch({
      [URL]: streamedResponse(Array.from({ length: 65 }, () => chunk)),
    });
    await expect(lichessFidePlayer(fetch, ID, never)).rejects.toThrow(
      'larger than 65536 bytes',
    );
  });

  it('fails on another error status, and cancels its body', async () => {
    const answer = trackedResponse([new Uint8Array(2)], 429);
    const fetch = fakeFetch({ [URL]: answer.response });
    await expect(lichessFidePlayer(fetch, ID, never)).rejects.toThrow(
      'the FIDE player answer was 429',
    );
    expect(answer.cancelled()).toBe(true);
  });

  it('cancels the body of a 404', async () => {
    const answer = trackedResponse([new Uint8Array(2)], 404);
    const fetch = fakeFetch({ [URL]: answer.response });
    await expect(lichessFidePlayer(fetch, ID, never)).resolves.toMatchObject({
      ok: false,
    });
    expect(answer.cancelled()).toBe(true);
  });

  it.each([1, 999_999_999])('asks for FIDE ID %s', async (id) => {
    const url = `https://lichess.org/api/fide/player/${String(id)}`;
    const fetch = fakeFetch({ [url]: json({ ...PLAYER, id }) });
    await expect(lichessFidePlayer(fetch, id, never)).resolves.toMatchObject({
      ok: true,
    });
    expect(fetch.calls.map((call) => call.url)).toEqual([url]);
  });

  it.each([
    [4000, true],
    [4001, false],
    [0, true],
  ])('takes standard rating %s as valid: %s', async (standard, valid) => {
    const fetch = fakeFetch({ [URL]: json({ ...PLAYER, standard }) });
    const player = await lichessFidePlayer(fetch, ID, never);
    expect(player.ok).toBe(valid);
  });

  it.each([0, -1, 1.5, 1_000_000_000, Number.NaN])(
    'throws for %s, which is no FIDE ID, before any request',
    async (id) => {
      const fetch = fakeFetch({});
      await expect(lichessFidePlayer(fetch, id, never)).rejects.toThrow(
        RangeError,
      );
      expect(fetch.calls).toEqual([]);
    },
  );

  describe('error texts never hold the FIDE ID or its URL', () => {
    const idFree = (error: unknown): void => {
      const text = `${String(error)} ${error instanceof Error ? (error.stack ?? '') : ''}`;
      expect(text).not.toContain(String(ID));
      expect(text).not.toContain('/api/fide/player');
    };

    it.each([
      ['an error status', () => Promise.resolve(json({}, 500))],
      [
        'an oversized answer',
        () =>
          Promise.resolve(
            streamedResponse(
              Array.from({ length: 65 }, () => new Uint8Array(1024)),
            ),
          ),
      ],
      [
        'a failed request',
        () => Promise.reject(new Error(`fetch failed for ${URL}`)),
      ],
    ])('on %s', async (_, answer) => {
      const fetch = (): Promise<Response> => answer();
      const error: unknown = await lichessFidePlayer(fetch, ID, never).then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(Error);
      idFree(error);
    });

    it('on an ID out of range', async () => {
      const error: unknown = await lichessFidePlayer(
        fakeFetch({}),
        1_000_000_000,
        never,
      ).then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(RangeError);
      expect(String(error)).not.toContain('1000000000');
    });

    it('rethrows the abort reason of an aborted request', async () => {
      const controller = new AbortController();
      controller.abort(new Error('timed out'));
      const fetch = (): Promise<Response> =>
        Promise.reject(new Error(`aborted ${URL}`));
      await expect(
        lichessFidePlayer(fetch, ID, controller.signal),
      ).rejects.toThrow(/^timed out$/);
    });
  });
});
