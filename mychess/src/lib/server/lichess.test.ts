import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchLichessRatings } from './lichess';

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status })
  );
}

describe('fetchLichessRatings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('includes a variant when it has games played', async () => {
    mockFetch({
      perfs: {
        blitz: { games: 500, rating: 2650 },
        bullet: { games: 0, rating: 1500 }
      }
    });
    const result = await fetchLichessRatings('magnus');
    expect(result).toEqual({ blitz: 2650 });
  });

  it('excludes a variant with zero games', async () => {
    mockFetch({
      perfs: {
        rapid: { games: 0, rating: 1500 },
        classical: { games: 12, rating: 2100 }
      }
    });
    const result = await fetchLichessRatings('magnus');
    expect(result).toEqual({ classical: 2100 });
  });

  it('returns an empty object when no variant has games', async () => {
    mockFetch({
      perfs: {
        bullet: { games: 0, rating: 1500 },
        blitz: { games: 0, rating: 1500 }
      }
    });
    const result = await fetchLichessRatings('newplayer');
    expect(result).toEqual({});
  });

  it('returns null on a non-200 response', async () => {
    mockFetch({ error: 'Not found' }, 404);
    const result = await fetchLichessRatings('doesnotexist');
    expect(result).toBeNull();
  });

  it('returns null when the response body is malformed JSON', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('not json', { status: 200 })
    );
    const result = await fetchLichessRatings('magnus');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const result = await fetchLichessRatings('magnus');
    expect(result).toBeNull();
  });

  it('fetches the correct Lichess URL', async () => {
    const spy = mockFetch({ perfs: {} });
    await fetchLichessRatings('DrNykterstein');
    expect(spy).toHaveBeenCalledWith(
      'https://lichess.org/api/user/DrNykterstein',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});
