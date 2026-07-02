import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchChesscomRatings } from './chesscom';

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status })
  );
}

describe('fetchChesscomRatings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('includes a variant when its key is present', async () => {
    mockFetch({
      chess_rapid: { last: { rating: 1900 } },
      chess_blitz: { last: { rating: 1800 } }
    });
    const result = await fetchChesscomRatings('magnus');
    expect(result).toEqual({ rapid: 1900, blitz: 1800 });
  });

  it('excludes a variant whose key is missing', async () => {
    mockFetch({
      chess_rapid: { last: { rating: 1900 } }
    });
    const result = await fetchChesscomRatings('magnus');
    expect(result).toEqual({ rapid: 1900 });
  });

  it('maps tactics.highest.rating to puzzle', async () => {
    mockFetch({
      tactics: { highest: { rating: 2100 }, lowest: { rating: 1000 } }
    });
    const result = await fetchChesscomRatings('magnus');
    expect(result).toEqual({ puzzle: 2100 });
  });

  it('returns an empty object when no variant is present', async () => {
    mockFetch({});
    const result = await fetchChesscomRatings('newplayer');
    expect(result).toEqual({});
  });

  it('returns null on a non-200 response', async () => {
    mockFetch({ error: 'Not found' }, 404);
    const result = await fetchChesscomRatings('doesnotexist');
    expect(result).toBeNull();
  });

  it('returns null when the response body is malformed JSON', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('not json', { status: 200 })
    );
    const result = await fetchChesscomRatings('magnus');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const result = await fetchChesscomRatings('magnus');
    expect(result).toBeNull();
  });

  it('fetches the correct Chess.com URL', async () => {
    const spy = mockFetch({});
    await fetchChesscomRatings('MagnusCarlsen');
    expect(spy).toHaveBeenCalledWith(
      'https://api.chess.com/pub/player/MagnusCarlsen/stats',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});
