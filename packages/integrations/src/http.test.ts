import { describe, expect, it } from 'vitest';
import {
  cappedBytes,
  get,
  getOk,
  readBody,
  readCappedText,
  TooLargeError,
  USER_AGENT,
} from './http';
import {
  fakeFetch,
  never,
  stalledResponse,
  trackedResponse,
} from './test-support';

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

  it('fails past the cap with a TooLargeError, and cancels the body', async () => {
    const answer = trackedResponse([
      new Uint8Array(6),
      new Uint8Array(6),
      new Uint8Array(6),
      new Uint8Array(6),
    ]);
    await expect(
      readCappedText(answer.response, 10, never, 'sample'),
    ).rejects.toBeInstanceOf(TooLargeError);
    expect(answer.cancelled()).toBe(true);
  });
  it('cancels a stalled body on abort and fails with the reason', async () => {
    const controller = new AbortController();
    const stalled = stalledResponse();
    const reading = readCappedText(
      stalled.response,
      10,
      controller.signal,
      'sample',
    );
    const reason = new Error('stop');
    controller.abort(reason);
    await expect(reading).rejects.toBe(reason);
    expect(stalled.cancelled()).toBe(true);
  });

  it('cancels the body when the signal is already aborted', async () => {
    const answer = trackedResponse([new Uint8Array(2)]);
    const reason = new Error('stop');
    await expect(
      readCappedText(answer.response, 10, AbortSignal.abort(reason), 'sample'),
    ).rejects.toBe(reason);
    expect(answer.cancelled()).toBe(true);
  });
});

describe('get', () => {
  it('sends extra headers, never overriding the User-Agent', async () => {
    const fetch = fakeFetch({ 'https://example.org/': new Response('') });
    await get(fetch, 'https://example.org/', never, {
      Authorization: 'Bearer x',
      'User-Agent': 'Other',
    });
    expect(fetch.calls[0]?.init.headers).toEqual({
      Authorization: 'Bearer x',
      'User-Agent': USER_AGENT,
    });
  });
});

describe('readBody', () => {
  const chunks = (): Uint8Array[] => [
    new Uint8Array(3),
    new Uint8Array(4),
    new Uint8Array(3),
  ];

  it('yields the chunks of a body up to the cap, then ends', async () => {
    const answer = trackedResponse(chunks());
    const body = readBody(answer.response, 10, never, 'sample');
    await expect(collect(body.chunks)).resolves.toEqual([3, 4, 3]);
  });

  it('yields nothing for a response without a body', async () => {
    const body = readBody(new Response(null, { status: 204 }), 10, never, 'x');
    await expect(collect(body.chunks)).resolves.toEqual([]);
  });

  it('fails past the cap, and cancels the body', async () => {
    const answer = trackedResponse([...chunks(), ...chunks()]);
    const body = readBody(answer.response, 10, never, 'sample');
    await expect(collect(body.chunks)).rejects.toThrow(TooLargeError);
    expect(answer.cancelled()).toBe(true);
  });

  it('cancels the body when the reader stops early', async () => {
    const answer = trackedResponse([...chunks(), ...chunks()]);
    const body = readBody(answer.response, 100, never, 'sample');
    for await (const chunk of body.chunks) {
      expect(chunk.byteLength).toBe(3);
      break;
    }
    expect(answer.cancelled()).toBe(true);
  });

  it('cancels a stalled body on abort and fails with the reason', async () => {
    const controller = new AbortController();
    const stalled = stalledResponse();
    const body = readBody(stalled.response, 10, controller.signal, 'sample');
    const reading = collect(body.chunks);
    const reason = new Error('stop');
    controller.abort(reason);
    await expect(reading).rejects.toBe(reason);
    expect(stalled.cancelled()).toBe(true);
  });

  it('cancels at once on a signal already aborted, unread', () => {
    const stalled = stalledResponse();
    readBody(stalled.response, 10, AbortSignal.abort(new Error('x')), 'y');
    expect(stalled.cancelled()).toBe(true);
  });

  it('fails with the abort reason when aborted before reading', async () => {
    const answer = trackedResponse(chunks());
    const reason = new Error('stop');
    const body = readBody(answer.response, 10, AbortSignal.abort(reason), 'x');
    await expect(collect(body.chunks)).rejects.toBe(reason);
  });

  it('on cancel, ends a stalled read and fails with the cancel reason', async () => {
    const stalled = stalledResponse();
    const body = readBody(stalled.response, 10, never, 'sample');
    const reading = collect(body.chunks);
    const reason = new Error('closed');
    body.cancel(reason);
    await expect(reading).rejects.toBe(reason);
    expect(stalled.cancelled()).toBe(true);
  });

  it('cancelled before reading, cancels the body, and reading fails', async () => {
    const answer = trackedResponse(chunks());
    const body = readBody(answer.response, 10, never, 'sample');
    const reason = new Error('closed');
    body.cancel(reason);
    expect(answer.cancelled()).toBe(true);
    await expect(collect(body.chunks)).rejects.toBe(reason);
  });

  it('keeps the first cancel reason, before a later cancel or abort', async () => {
    const controller = new AbortController();
    const body = readBody(
      stalledResponse().response,
      10,
      controller.signal,
      'sample',
    );
    const first = new Error('closed');
    body.cancel(first);
    body.cancel(new Error('again'));
    controller.abort(new Error('late'));
    await expect(collect(body.chunks)).rejects.toBe(first);
  });

  it('fails on a body that errors while read, and cancels it', async () => {
    let pulls = 0;
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new Uint8Array(2));
        else controller.error(new Error('connection reset'));
      },
    });
    const body = readBody(new Response(failing), 10, never, 'sample');
    await expect(collect(body.chunks)).rejects.toThrow('connection reset');
  });
});
