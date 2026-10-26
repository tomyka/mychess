import type { Account } from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const DB = { name: 'the db' };
const NOW = new Date('2026-10-20T08:00:00Z');
const REPERTOIRE = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

const server = vi.hoisted(() => ({
  account: vi.fn<() => Promise<unknown>>(),
  counted:
    vi.fn<
      (db: unknown, key: string, rule: unknown, now: Date) => Promise<unknown>
    >(),
  weighted:
    vi.fn<
      (
        db: unknown,
        request: { key: string; rule: unknown; now: Date; weight: number },
      ) => Promise<unknown>
    >(),
  record:
    vi.fn<
      (
        db: unknown,
        playerId: string,
        batch: unknown,
        now: Date,
      ) => Promise<unknown>
    >(),
}));

vi.mock('@mychess/db', () => ({
  countRateLimited: server.counted,
  countWeighted: server.weighted,
  recordResults: server.record,
}));
vi.mock('../../../../server/db', () => ({ getDb: () => DB }));
vi.mock('../../../../server/session', () => ({ getAccount: server.account }));

/** Rokas, signed in and onboarded: the session account. */
const ROKAS: Account = {
  id: 'rokas',
  email: 'rokas@example.test',
  emailVerified: true,
  displayName: 'Rokas',
  locale: 'lt',
  entitlement: 'free',
  admin: false,
  disabledAt: null,
  onboardedAt: NOW,
  coachSince: null,
  createdAt: NOW,
};

/** One result as the browser queues it, with its own id. */
const result = (n: number) => ({
  resultId: `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`,
  kind: 'pass',
  moveKey: 'k1|d4',
  repertoireId: REPERTOIRE,
  answeredAt: '2026-10-20T07:59:00.000Z',
});

const post = (body: string, headers: HeadersInit = JSON_BODY) =>
  POST(
    new Request('http://x/api/training/results', {
      method: 'POST',
      headers,
      body,
    }),
  );

const JSON_BODY = { 'content-type': 'application/json' };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.account.mockReset().mockResolvedValue(ROKAS);
  server.counted.mockReset().mockResolvedValue({ ok: true, value: undefined });
  server.weighted.mockReset().mockResolvedValue({ ok: true, value: undefined });
  server.record
    .mockReset()
    .mockResolvedValue([{ resultId: result(1).resultId, status: 'applied' }]);
  return () => {
    vi.useRealTimers();
  };
});

describe('POST /api/training/results', () => {
  it('records the batch for the session account and answers per result', async () => {
    const response = await post(JSON.stringify([result(1)]));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      answers: [{ resultId: result(1).resultId, status: 'applied' }],
    });
    expect(server.counted).toHaveBeenCalledExactlyOnceWith(
      DB,
      'training:rokas',
      expect.objectContaining({ reason: 'training.tooManyResults' }),
      NOW,
    );
    expect(server.record).toHaveBeenCalledExactlyOnceWith(
      DB,
      'rokas',
      [{ ...result(1), answeredAt: new Date(result(1).answeredAt) }],
      NOW,
    );
  });

  it('counts the results of a parsed batch, each as one, on their own key', async () => {
    const batch = Array.from({ length: 7 }, (_, n) => result(n));
    expect((await post(JSON.stringify(batch))).status).toBe(200);
    expect(server.weighted).toHaveBeenCalledExactlyOnceWith(DB, {
      key: 'training-results:rokas',
      rule: { windowMs: 60_000, max: 600, reason: 'training.tooManyResults' },
      now: NOW,
      weight: 7,
    });
  });

  it('is 429 with the reason when too many results, and records nothing', async () => {
    server.weighted.mockResolvedValue({
      ok: false,
      refusal: { reason: 'training.tooManyResults', limit: 600 },
    });
    const response = await post(JSON.stringify([result(1)]));
    expect(response.status).toBe(429);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      reason: 'training.tooManyResults',
    });
    expect(server.record).not.toHaveBeenCalled();
  });

  it('counts no results for a batch that does not parse', async () => {
    expect((await post('[]')).status).toBe(400);
    expect(server.weighted).not.toHaveBeenCalled();
  });

  it('is 413 for a declared body over 256 KB, unread and unrecorded', async () => {
    const response = await post('not json', {
      ...JSON_BODY,
      'content-length': String(256 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ reason: 'training.badBatch' });
    expect(server.weighted).not.toHaveBeenCalled();
    expect(server.record).not.toHaveBeenCalled();
  });

  it('takes a declared body of 256 KB, and one with no declared length', async () => {
    const body = JSON.stringify([result(1)]);
    const at = await post(body, {
      ...JSON_BODY,
      'content-length': String(256 * 1024),
    });
    expect(at.status).not.toBe(413);
    const undeclared = await post(body);
    expect(undeclared.status).toBe(200);
  });

  it('never takes the player from the body', async () => {
    await post(JSON.stringify([{ ...result(1), playerId: 'gabija' }]));
    expect(server.record).toHaveBeenCalledExactlyOnceWith(
      DB,
      'rokas',
      [{ ...result(1), answeredAt: new Date(result(1).answeredAt) }],
      NOW,
    );
  });

  it('is 401 signed out, and counts and records nothing', async () => {
    server.account.mockResolvedValue(null);
    const response = await post(JSON.stringify([result(1)]));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(server.counted).not.toHaveBeenCalled();
    expect(server.record).not.toHaveBeenCalled();
  });

  it('is 403 before onboarding, and records nothing', async () => {
    server.account.mockResolvedValue({ ...ROKAS, onboardedAt: null });
    const response = await post(JSON.stringify([result(1)]));
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(server.record).not.toHaveBeenCalled();
  });

  it('is 429 with the reason when rate limited, before reading the body', async () => {
    server.counted.mockResolvedValue({
      ok: false,
      refusal: { reason: 'training.tooManyResults', limit: 120 },
    });
    const response = await post('not json');
    expect(response.status).toBe(429);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      reason: 'training.tooManyResults',
    });
    expect(server.record).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', 'not json'],
    ['an empty batch', '[]'],
    [
      '201 results',
      JSON.stringify(Array.from({ length: 201 }, (_, n) => result(n))),
    ],
    [
      'a result without its id',
      JSON.stringify([{ ...result(1), resultId: 'x' }]),
    ],
    ['an object', JSON.stringify({ results: [result(1)] })],
  ])('is 400 for %s', async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ reason: 'training.badBatch' });
    expect(server.record).not.toHaveBeenCalled();
  });

  it.each([
    ['text/plain', { 'content-type': 'text/plain' }],
    ['a form', { 'content-type': 'application/x-www-form-urlencoded' }],
  ])(
    'is 415 for %s, after counting and before recording',
    async (_name, headers) => {
      const response = await post(JSON.stringify([result(1)]), headers);
      expect(response.status).toBe(415);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ reason: 'training.badBatch' });
      expect(server.counted).toHaveBeenCalledOnce();
      expect(server.record).not.toHaveBeenCalled();
    },
  );

  it('takes JSON with a charset', async () => {
    const response = await post(JSON.stringify([result(1)]), {
      'content-type': 'Application/JSON; charset=utf-8',
    });
    expect(response.status).toBe(200);
    expect(server.record).toHaveBeenCalledOnce();
  });

  it('takes the largest batch', async () => {
    const batch = Array.from({ length: 200 }, (_, n) => result(n));
    const response = await post(JSON.stringify(batch));
    expect(response.status).toBe(200);
    expect(server.record).toHaveBeenCalledOnce();
  });
});
