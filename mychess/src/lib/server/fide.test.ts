import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchFideName } from './fide';

const VALID_HTML = `
<html><body>
  <h1 class="player-title">Carlsen, Magnus</h1>
</body></html>
`;

const MULTI_WORD_SURNAME_HTML = `
<html><body>
  <h1 class="player-title">Van Foreest, Jorden</h1>
</body></html>
`;

const MISSING_TITLE_HTML = `<html><body><h1>Nothing here</h1></body></html>`;

function mockFetch(html: string, status = 200) {
  return vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(html, { status })
  );
}

describe('fetchFideName', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns firstName and lastName for a valid profile', async () => {
    mockFetch(VALID_HTML);
    const result = await fetchFideName('1503014');
    expect(result).toEqual({ firstName: 'Magnus', lastName: 'Carlsen' });
  });

  it('handles multi-word surnames', async () => {
    mockFetch(MULTI_WORD_SURNAME_HTML);
    const result = await fetchFideName('24116068');
    expect(result).toEqual({ firstName: 'Jorden', lastName: 'Van Foreest' });
  });

  it('returns null when FIDE page has no player-title h1', async () => {
    mockFetch(MISSING_TITLE_HTML);
    const result = await fetchFideName('9999999');
    expect(result).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    mockFetch('', 404);
    const result = await fetchFideName('0');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const result = await fetchFideName('1503014');
    expect(result).toBeNull();
  });

  it('fetches the correct FIDE URL', async () => {
    const spy = mockFetch(VALID_HTML);
    await fetchFideName('1503014');
    expect(spy).toHaveBeenCalledWith(
      'https://ratings.fide.com/profile/1503014',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});
