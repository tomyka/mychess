import { BROADCAST_LIST_URL } from '@mychess/integrations';
import { describe, expect, it, vi } from 'vitest';
import {
  createBroadcastSources,
  PLAYER_CACHE_MS,
  MONTHS_CACHE_MS,
  PLAYER_CACHE_SIZE,
} from './broadcast-sources';

const T0 = new Date('2026-11-10T10:00:00Z').getTime();

const LIST = [
  'https://database.lichess.org/broadcast/lichess_db_broadcast_2026-09.pgn.zst',
  'https://database.lichess.org/broadcast/lichess_db_broadcast_2026-10.pgn.zst',
].join('\n');

const PLAYER = {
  id: 13_400_002,
  name: 'Jonaitis, Rokas',
  federation: 'LTU',
  standard: 2312,
};

type Answer = () => Response;

/** A fake fetch answering by URL, with every call recorded. */
function fakeFetch(answers: Record<string, Answer>) {
  return vi.fn((url: string) => {
    const answer = answers[url];
    if (answer === undefined) return Promise.reject(new Error('offline'));
    return Promise.resolve(answer());
  });
}

const listAnswer: Answer = () => new Response(LIST);
const playerUrl = (id: number) =>
  `https://lichess.org/api/fide/player/${String(id)}`;
const playerAnswer =
  (id: number): Answer =>
  () =>
    Response.json({ ...PLAYER, id });

function sourcesWith(fetch: ReturnType<typeof fakeFetch>) {
  let now = T0;
  const sources = createBroadcastSources({ fetch, clock: () => new Date(now) });
  return {
    sources,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('the broadcast months', () => {
  it('are the published months, newest first, fetched once an hour', async () => {
    const fetch = fakeFetch({ [BROADCAST_LIST_URL]: listAnswer });
    const { sources, advance } = sourcesWith(fetch);
    expect(await sources.months()).toEqual(['2026-10', '2026-09']);
    advance(MONTHS_CACHE_MS - 1);
    await sources.months();
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(1);
    await sources.months();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(MONTHS_CACHE_MS).toBe(60 * 60_000);
  });

  it('share one request between searches that ask at once', async () => {
    const fetch = fakeFetch({ [BROADCAST_LIST_URL]: listAnswer });
    const { sources } = sourcesWith(fetch);
    await Promise.all([sources.months(), sources.months()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fail when the list cannot be read, and are asked again next time', async () => {
    const fetch = fakeFetch({});
    const { sources } = sourcesWith(fetch);
    await expect(sources.months()).rejects.toThrow();
    await expect(sources.months()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('the FIDE player', () => {
  it('is fetched once a day per ID', async () => {
    const fetch = fakeFetch({
      [playerUrl(PLAYER.id)]: playerAnswer(PLAYER.id),
    });
    const { sources, advance } = sourcesWith(fetch);
    expect(await sources.player(PLAYER.id)).toEqual({
      name: PLAYER.name,
      federation: 'LTU',
      title: null,
      standardRating: 2312,
    });
    advance(PLAYER_CACHE_MS - 1);
    await sources.player(PLAYER.id);
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(1);
    await sources.player(PLAYER.id);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(PLAYER_CACHE_MS).toBe(24 * 60 * 60_000);
  });

  it('is null, and remembered, for a player Lichess does not know', async () => {
    const fetch = fakeFetch({
      [playerUrl(7)]: () => new Response('', { status: 404 }),
    });
    const { sources } = sourcesWith(fetch);
    expect(await sources.player(7)).toBeNull();
    expect(await sources.player(7)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('is null, and asked again next time, when the request fails', async () => {
    const fetch = fakeFetch({
      [playerUrl(7)]: () => new Response('', { status: 503 }),
    });
    const { sources } = sourcesWith(fetch);
    expect(await sources.player(7)).toBeNull();
    expect(await sources.player(8)).toBeNull();
    expect(await sources.player(7)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps at most PLAYER_CACHE_SIZE players, dropping the oldest', async () => {
    const answers: Record<string, Answer> = {};
    for (let id = 1; id <= PLAYER_CACHE_SIZE + 1; id += 1)
      answers[playerUrl(id)] = playerAnswer(id);
    const fetch = fakeFetch(answers);
    const { sources } = sourcesWith(fetch);
    for (let id = 1; id <= PLAYER_CACHE_SIZE + 1; id += 1)
      await sources.player(id);
    await sources.player(PLAYER_CACHE_SIZE + 1);
    expect(fetch).toHaveBeenCalledTimes(PLAYER_CACHE_SIZE + 1);
    await sources.player(1);
    expect(fetch).toHaveBeenCalledTimes(PLAYER_CACHE_SIZE + 2);
  });
});
