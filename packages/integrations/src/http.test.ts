import { describe, expect, it } from 'vitest';
import { cappedBytes, getOk, readCappedText, USER_AGENT } from './http';
import { fakeFetch, never, trackedResponse } from './test-support';

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<number[]> {
  const sizes: number[] = [];
  for await (const chunk of chunks) sizes.push(chunk.byteLength);
  return sizes;
}

async function* chunksOf(...sizes: number[]): AsyncGenerator<Uint8Array> {
  for (const size of sizes) {
    await Promise.resolve();
    yield new Uint8Array(size);
  }
}

describe('cappedBytes', () => {
  it('passes chunks through while the total stays within the cap', async () => {
    await expect(
      collect(cappedBytes(chunksOf(3, 4, 3), 10, never, 'sample')),
    ).resolves.toEqual([3, 4, 3]);
  });

  it('fails once the bytes read pass the cap, naming what was capped', async () => {
    await expect(
      collect(cappedBytes(chunksOf(5, 5, 1), 10, never, 'sample')),
    ).rejects.toThrow('sample is larger than 10 bytes');
  });

  it('stops reading before a chunk once the signal is aborted', async () => {
    const controller = new AbortController();
    const read: number[] = [];
    const reading = (async () => {
      for await (const chunk of cappedBytes(
        chunksOf(1, 2, 3),
        10,
        controller.signal,
        'sample',
      )) {
        read.push(chunk.byteLength);
        controller.abort(new Error('stopped'));
      }
    })();
    await expect(reading).rejects.toThrow('stopped');
    expect(read).toEqual([1]);
  });
});

describe('getOk', () => {
  it('sends the app User-Agent, refuses redirects and passes the signal', async () => {
    const fetch = fakeFetch({ 'https://example.org/a': new Response('x') });
    const signal = new AbortController().signal;
    await getOk(fetch, 'https://example.org/a', signal);
    expect(fetch.calls).toEqual([
      {
        url: 'https://example.org/a',
        init: {
          redirect: 'error',
          signal,
          headers: { 'User-Agent': USER_AGENT },
        },
      },
    ]);
    expect(USER_AGENT).toMatch(/^MyChess \(\+https:\/\/mychess\.lt\)$/);
  });

  it('fails on a status other than 2xx, naming the status', async () => {
    const fetch = fakeFetch({
      'https://example.org/a': new Response('busy', { status: 503 }),
    });
    await expect(getOk(fetch, 'https://example.org/a', never)).rejects.toThrow(
      'GET https://example.org/a answered 503',
    );
  });

  it('cancels the body of an answer with a status other than 2xx', async () => {
    const answer = trackedResponse([new Uint8Array(4)], 500);
    const fetch = fakeFetch({ 'https://example.org/a': answer.response });
    await expect(getOk(fetch, 'https://example.org/a', never)).rejects.toThrow(
      'answered 500',
    );
    expect(answer.cancelled()).toBe(true);
  });
});

describe('readCappedText', () => {
  it('reads a body of up to the cap as UTF-8', async () => {
    await expect(
      readCappedText(new Response('šachmatai'), 10, never, 'sample'),
    ).resolves.toBe('šachmatai');
  });

  it('fails on a body larger than the cap', async () => {
    await expect(
      readCappedText(new Response('x'.repeat(11)), 10, never, 'sample'),
    ).rejects.toThrow('sample is larger than 10 bytes');
  });

  it('reads a response without a body as empty text', async () => {
    await expect(
      readCappedText(new Response(null, { status: 204 }), 10, never, 'sample'),
    ).resolves.toBe('');
  });
});
