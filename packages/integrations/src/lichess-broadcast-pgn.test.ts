import { describe, expect, it } from 'vitest';
import {
  LICHESS_BROADCAST_PGN_MAX_BYTES,
  openLichessBroadcastPgn,
} from './lichess-broadcast-pgn';
import {
  LICHESS_BROADCAST_REFUSALS,
  type LichessApi,
} from './lichess-broadcast-request';
import {
  collectAll,
  fakeFetch,
  never,
  stalledResponse,
  streamedResponse,
  trackedResponse,
  type FakeFetch,
} from './test-support';

const TOKEN = 'lip_SyntheticToken123';
const PGN_URL =
  'https://lichess.org/api/broadcast/AbCd1234.pgn?clocks=false&comments=false';

function api(fetch: FakeFetch): LichessApi {
  return { fetch, token: TOKEN };
}

function game(round: number, tags: Readonly<Record<string, string>>): string {
  const headers = Object.entries({
    Event: 'Synthetic Open 2026',
    Date: '2026.07.1' + String(round),
    White: 'Testas, Jonas',
    Black: 'Bandymas, Petras',
    Result: '1-0',
    BroadcastName: 'Synthetic Open 2026',
    GameURL: `https://lichess.org/broadcast/synthetic-open-2026/round-${String(round)}/RoUnD00${String(round)}/GaMe000${String(round)}`,
    ...tags,
  })
    .map(([name, value]) => `[${name} "${value}"]`)
    .join('\n');
  return `${headers}\n\n1. e4 e5 2. Nf3 { [Bracket] in a comment } Nc6 1-0\n\n`;
}

/** A synthetic tournament PGN: two games with FIDE IDs, one without. */
const PGN =
  game(1, { WhiteFideId: '90000001', BlackFideId: '90000002' }) +
  game(2, {}) +
  game(3, { BlackFideId: '90000001', Result: '1/2-1/2', ECO: 'C44' });

const encoded = new TextEncoder().encode(PGN);

/** `bytes` in chunks of `size`, as the network delivers them. */
function split(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < bytes.byteLength; start += size) {
    chunks.push(bytes.subarray(start, start + size));
  }
  return chunks;
}

describe('openLichessBroadcastPgn', () => {
  it('yields the games with a FIDE ID, as the dump parser reads them', async () => {
    const fetch = fakeFetch({ [PGN_URL]: streamedResponse(split(encoded, 7)) });
    const opened = await openLichessBroadcastPgn(api(fetch), 'AbCd1234', never);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await expect(collectAll(opened.value.games)).resolves.toEqual([
      {
        url: 'https://lichess.org/broadcast/synthetic-open-2026/round-1/RoUnD001/GaMe0001',
        white: 'Testas, Jonas',
        whiteFideId: 90000001,
        black: 'Bandymas, Petras',
        blackFideId: 90000002,
        date: '2026-07-11',
        result: '1-0',
        eco: null,
        opening: null,
        event: 'Synthetic Open 2026',
      },
      {
        url: 'https://lichess.org/broadcast/synthetic-open-2026/round-3/RoUnD003/GaMe0003',
        white: 'Testas, Jonas',
        whiteFideId: null,
        black: 'Bandymas, Petras',
        blackFideId: 90000001,
        date: '2026-07-13',
        result: '1/2-1/2',
        eco: 'C44',
        opening: null,
        event: 'Synthetic Open 2026',
      },
    ]);
  });

  it('asks without clocks or comments, with the token, refusing redirects', async () => {
    const fetch = fakeFetch({ [PGN_URL]: streamedResponse([encoded]) });
    await openLichessBroadcastPgn(api(fetch), 'AbCd1234', never);
    expect(fetch.calls.map((call) => call.url)).toEqual([PGN_URL]);
    expect(fetch.calls[0]?.init.redirect).toBe('error');
    expect(fetch.calls[0]?.init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': 'MyChess (+https://mychess.lt)',
    });
  });

  it.each([
    [404, LICHESS_BROADCAST_REFUSALS.notFound],
    [429, LICHESS_BROADCAST_REFUSALS.rateLimited],
    [401, LICHESS_BROADCAST_REFUSALS.unauthorized],
    [502, LICHESS_BROADCAST_REFUSALS.unavailable],
  ])('refuses status %s, and cancels its body', async (status, reason) => {
    const answer = trackedResponse([encoded], status);
    const fetch = fakeFetch({ [PGN_URL]: answer.response });
    await expect(
      openLichessBroadcastPgn(api(fetch), 'AbCd1234', never),
    ).resolves.toEqual({ ok: false, refusal: { reason } });
    expect(answer.cancelled()).toBe(true);
  });

  it('fails while reading past the byte cap, and cancels the body', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    const chunks = Array.from(
      { length: LICHESS_BROADCAST_PGN_MAX_BYTES / chunk.byteLength + 3 },
      () => chunk,
    );
    const answer = trackedResponse(chunks);
    const fetch = fakeFetch({ [PGN_URL]: answer.response });
    const opened = await openLichessBroadcastPgn(api(fetch), 'AbCd1234', never);
    if (!opened.ok) throw new Error('the PGN did not open');
    await expect(collectAll(opened.value.games)).rejects.toThrow(
      `larger than ${String(LICHESS_BROADCAST_PGN_MAX_BYTES)} bytes`,
    );
    expect(answer.cancelled()).toBe(true);
  });

  it('cancels the body when closed unread', async () => {
    const answer = trackedResponse([encoded]);
    const fetch = fakeFetch({ [PGN_URL]: answer.response });
    const opened = await openLichessBroadcastPgn(api(fetch), 'AbCd1234', never);
    if (!opened.ok) throw new Error('the PGN did not open');
    opened.value.close();
    expect(answer.cancelled()).toBe(true);
    await expect(collectAll(opened.value.games)).rejects.toThrow(
      'the broadcast tournament PGN was closed',
    );
  });

  it('cancels the body when disposed', async () => {
    const answer = trackedResponse([encoded]);
    const fetch = fakeFetch({ [PGN_URL]: answer.response });
    const opened = await openLichessBroadcastPgn(api(fetch), 'AbCd1234', never);
    if (!opened.ok) throw new Error('the PGN did not open');
    {
      await using pgn = opened.value;
      expect(pgn.games).toBeDefined();
    }
    expect(answer.cancelled()).toBe(true);
  });

  it('cancels the body when the reader stops early', async () => {
    const answer = trackedResponse(split(encoded, 16));
    const fetch = fakeFetch({ [PGN_URL]: answer.response });
    const opened = await openLichessBroadcastPgn(api(fetch), 'AbCd1234', never);
    if (!opened.ok) throw new Error('the PGN did not open');
    for await (const record of opened.value.games) {
      expect(record.whiteFideId).toBe(90000001);
      break;
    }
    expect(answer.cancelled()).toBe(true);
  });

  it('fails with the abort reason when aborted while the body stalls', async () => {
    const controller = new AbortController();
    const stalled = stalledResponse();
    const fetch = fakeFetch({ [PGN_URL]: stalled.response });
    const opened = await openLichessBroadcastPgn(
      api(fetch),
      'AbCd1234',
      controller.signal,
    );
    if (!opened.ok) throw new Error('the PGN did not open');
    const reading = collectAll(opened.value.games);
    const reason = new Error('shutting down');
    controller.abort(reason);
    await expect(reading).rejects.toBe(reason);
    expect(stalled.cancelled()).toBe(true);
  });

  it.each(['AbCd123', 'AbCd1234.pgn', '../../x/', 'AbCd123?'])(
    'throws for the tour id %j before any request',
    async (id) => {
      const fetch = fakeFetch({});
      await expect(
        openLichessBroadcastPgn(api(fetch), id, never),
      ).rejects.toThrow(RangeError);
      expect(fetch.calls).toEqual([]);
    },
  );
});
