// mychess/src/lib/fide/download.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { zipSync } from 'fflate';
import { streamPlayersList } from './download';

function bodyFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    }
  });
}

/** Splits `bytes` into chunks of at most `size`, to simulate the network arriving in pieces. */
function splitIntoChunks(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.subarray(i, i + size));
  return chunks.length > 0 ? chunks : [bytes];
}

function zipOf(xml: string): Uint8Array {
  return zipSync({ 'players_list_xml_foa.xml': new TextEncoder().encode(xml) });
}

function okResponse(body: ReadableStream<Uint8Array>) {
  return { ok: true, status: 200, statusText: 'OK', body };
}

describe('streamPlayersList', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('streams the decompressed XML in chunks, ending with a final=true call, without ever buffering it whole', async () => {
    const xml = '<playerslist><player><fideid>1</fideid></player></playerslist>';
    const zip = zipOf(xml);
    // Small chunk size forces multiple network reads AND multiple unzip pushes.
    fetchMock.mockResolvedValueOnce(okResponse(bodyFromChunks(splitIntoChunks(zip, 16))));

    const received: { chunk: Uint8Array; final: boolean }[] = [];
    await streamPlayersList((chunk, final) => received.push({ chunk: chunk.slice(), final }));

    expect(received.length).toBeGreaterThan(0);
    expect(received[received.length - 1].final).toBe(true);
    expect(received.slice(0, -1).every((r) => r.final === false)).toBe(true);

    const reassembled = new TextDecoder().decode(
      received.reduce((acc, r) => {
        const merged = new Uint8Array(acc.length + r.chunk.length);
        merged.set(acc);
        merged.set(r.chunk, acc.length);
        return merged;
      }, new Uint8Array())
    );
    expect(reassembled).toBe(xml);
  });

  it('retries after a thrown network error and still streams correctly once it succeeds', async () => {
    const xml = '<playerslist></playerslist>';
    const zip = zipOf(xml);
    fetchMock.mockRejectedValueOnce(new Error('connect timeout')).mockResolvedValueOnce(okResponse(bodyFromChunks([zip])));

    const receivedChunks: Uint8Array[] = [];
    const promise = streamPlayersList((chunk) => receivedChunks.push(chunk.slice()));
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const reassembled = new TextDecoder().decode(
      receivedChunks.reduce((acc, c) => {
        const merged = new Uint8Array(acc.length + c.length);
        merged.set(acc);
        merged.set(c, acc.length);
        return merged;
      }, new Uint8Array())
    );
    expect(reassembled).toBe(xml);
  });

  it('throws when the response has no body to stream', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', body: null });
    await expect(streamPlayersList(() => {})).rejects.toThrow('FIDE download response has no body to stream');
  });

  it('throws when the zip archive contains no files', async () => {
    const emptyZip = zipSync({});
    fetchMock.mockResolvedValueOnce(okResponse(bodyFromChunks([emptyZip])));
    await expect(streamPlayersList(() => {})).rejects.toThrow('FIDE zip archive is empty');
  });

  it('gives up after exhausting every attempt and throws the last thrown error', async () => {
    fetchMock.mockRejectedValue(new Error('connect timeout'));
    const promise = streamPlayersList(() => {});
    const assertion = expect(promise).rejects.toThrow('connect timeout');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws a descriptive error for the final non-ok response after exhausting every attempt', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
    const promise = streamPlayersList(() => {});
    const assertion = expect(promise).rejects.toThrow('FIDE download failed: 500 Internal Server Error');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
