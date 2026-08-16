// mychess/src/lib/fide/download.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fflate', () => ({
  unzipSync: vi.fn(() => ({ 'players.xml': new Uint8Array([1, 2, 3]) }))
}));

import { downloadPlayersList } from './download';

function okResponse() {
  return { ok: true, status: 200, statusText: 'OK', arrayBuffer: async () => new ArrayBuffer(0) };
}

describe('downloadPlayersList', () => {
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

  it('returns the decompressed bytes on a successful first attempt, with no retry', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const result = await downloadPlayersList('https://example.com/list.zip');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('retries after a thrown network error (e.g. a connect timeout) and succeeds on the next attempt', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect timeout')).mockResolvedValueOnce(okResponse());
    const promise = downloadPlayersList('https://example.com/list.zip');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('retries after non-ok responses and succeeds once FIDE\'s server recovers', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
      .mockResolvedValueOnce({ ok: false, status: 502, statusText: 'Bad Gateway' })
      .mockResolvedValueOnce(okResponse());
    const promise = downloadPlayersList('https://example.com/list.zip');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('gives up after exhausting every attempt and throws the last thrown error', async () => {
    fetchMock.mockRejectedValue(new Error('connect timeout'));
    const promise = downloadPlayersList('https://example.com/list.zip');
    const assertion = expect(promise).rejects.toThrow('connect timeout');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws a descriptive error for the final non-ok response after exhausting every attempt', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
    const promise = downloadPlayersList('https://example.com/list.zip');
    const assertion = expect(promise).rejects.toThrow('FIDE download failed: 500 Internal Server Error');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
