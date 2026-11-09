import { describe, expect, it } from 'vitest';
import { BROADCAST_LIST_URL, broadcastMonths } from './broadcast-months';
import { fakeFetch, never, streamedResponse } from './test-support';

const DUMPS = 'https://database.lichess.org/broadcast';

function listing(text: string): Response {
  return new Response(text, { headers: { 'Content-Type': 'text/plain' } });
}

describe('broadcastMonths', () => {
  it('reads the months from the dump file names, newest first', async () => {
    const fetch = fakeFetch({
      [BROADCAST_LIST_URL]: listing(
        [
          `${DUMPS}/lichess_db_broadcast_2026-08.pgn.zst`,
          `${DUMPS}/lichess_db_broadcast_2026-09.pgn.zst`,
          `${DUMPS}/lichess_db_broadcast_2025-12.pgn.zst\r`,
          '',
        ].join('\n'),
      ),
    });
    await expect(broadcastMonths(fetch, never)).resolves.toEqual([
      '2026-09',
      '2026-08',
      '2025-12',
    ]);
    expect(fetch.calls.map((call) => call.url)).toEqual([
      'https://database.lichess.org/broadcast/list.txt',
    ]);
    expect(fetch.calls[0]?.init.redirect).toBe('error');
  });

  it('takes the month from the file name only, wherever the line points', async () => {
    const fetch = fakeFetch({
      [BROADCAST_LIST_URL]: listing(
        'https://evil.example/x/lichess_db_broadcast_2026-07.pgn.zst\n',
      ),
    });
    await expect(broadcastMonths(fetch, never)).resolves.toEqual(['2026-07']);
    expect(fetch.calls).toHaveLength(1);
  });

  it('skips lines that are not a monthly dump, and repeated months', async () => {
    const fetch = fakeFetch({
      [BROADCAST_LIST_URL]: listing(
        [
          `${DUMPS}/lichess_db_broadcast_2026-13.pgn.zst`,
          `${DUMPS}/lichess_db_broadcast_2026-00.pgn.zst`,
          `${DUMPS}/lichess_db_broadcast_2026-05.pgn.zst.md5`,
          `${DUMPS}/lichess_db_standard_rated_2026-05.pgn.zst`,
          `${DUMPS}/lichess_db_broadcast_2026-5.pgn.zst`,
          'javascript:alert(1)',
          `${DUMPS}/lichess_db_broadcast_2026-05.pgn.zst`,
          `  ${DUMPS}/lichess_db_broadcast_2026-05.pgn.zst  `,
        ].join('\n'),
      ),
    });
    await expect(broadcastMonths(fetch, never)).resolves.toEqual(['2026-05']);
  });

  it('fails when the list is larger than 64 KB, counted while reading', async () => {
    const line = new TextEncoder().encode(
      `${DUMPS}/lichess_db_broadcast_2026-05.pgn.zst\n`,
    );
    const fetch = fakeFetch({
      [BROADCAST_LIST_URL]: streamedResponse(
        Array.from({ length: Math.ceil(65_537 / line.byteLength) }, () => line),
      ),
    });
    await expect(broadcastMonths(fetch, never)).rejects.toThrow(
      'larger than 65536 bytes',
    );
  });

  it('fails when the list answers with an error status', async () => {
    const fetch = fakeFetch({
      [BROADCAST_LIST_URL]: new Response('gone', { status: 404 }),
    });
    await expect(broadcastMonths(fetch, never)).rejects.toThrow('answered 404');
  });
});
