// mychess/src/lib/fide/download.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { zipSync } from 'fflate';
import type { FlateError, UnzipFile, UnzipFileHandler } from 'fflate';
import { streamPlayersList } from './download';

// fflate reports inflate failures (corrupt/truncated deflate stream, bad CRC)
// through `file.ondata(err, …)` rather than by throwing out of `push`, and
// which push the error lands on depends on where the damage sits in the
// archive. `finalFlushError` lets one test pin the case that matters most: an
// error raised by the *final* flush push, whose `pendingError` used to be
// collected and then dropped on the floor. Everything else delegates to the
// real fflate, so the rest of this file still exercises genuine zips.
const script = vi.hoisted(() => ({ finalFlushError: null as FlateError | null }));

vi.mock('fflate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fflate')>();
  let lastFile: UnzipFile | null = null;
  class ScriptedUnzip extends actual.Unzip {
    constructor(cb: UnzipFileHandler) {
      super((file) => {
        lastFile = file;
        cb(file);
      });
    }
    push(chunk: Uint8Array, final?: boolean): void {
      super.push(chunk, final);
      if (final && script.finalFlushError && lastFile?.ondata) {
        lastFile.ondata(script.finalFlushError, new Uint8Array(0), true);
      }
    }
  }
  return { ...actual, Unzip: ScriptedUnzip };
});

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
    script.finalFlushError = null;
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

  it('throws a decode error raised by the final flush instead of resolving with a partial list', async () => {
    const xml = '<playerslist><player><fideid>1</fideid></player></playerslist>';
    fetchMock.mockResolvedValueOnce(okResponse(bodyFromChunks(splitIntoChunks(zipOf(xml), 16))));
    script.finalFlushError = Object.assign(new Error('invalid distance'), { code: 3 }) as FlateError;

    const received: Uint8Array[] = [];
    await expect(streamPlayersList((chunk) => received.push(chunk.slice()))).rejects.toThrow(
      'invalid distance'
    );
    // The whole point of the bug: bytes really were handed to the caller before
    // the error, so swallowing it meant returning normally with a short list.
    expect(received.length).toBeGreaterThan(0);
  });

  it('rejects a truncated archive rather than resolving with the bytes decoded so far', async () => {
    const xml =
      '<playerslist>' + '<player><fideid>1</fideid></player>'.repeat(2000) + '</playerslist>';
    const zip = zipOf(xml);
    const truncated = zip.subarray(0, Math.floor(zip.length / 2));
    fetchMock.mockResolvedValueOnce(okResponse(bodyFromChunks([truncated])));

    const received: Uint8Array[] = [];
    const promise = streamPlayersList((chunk) => received.push(chunk.slice()));
    await expect(promise).rejects.toThrow(/invalid zip data/);
    // Partial output was emitted first — exactly the state the old code
    // returned successfully from.
    expect(received.reduce((n, c) => n + c.length, 0)).toBeGreaterThan(0);
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
