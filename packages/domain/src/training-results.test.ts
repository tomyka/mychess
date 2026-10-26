import { describe, expect, it } from 'vitest';
import { TRAINING_REFUSALS } from './training';
import {
  MAX_BATCH_BODY_BYTES,
  MAX_RESULT_BATCH,
  batchResponse,
  isLogged,
  resultAnswer,
  resultBatchSchema,
  settleFlush,
  unreadRefusal,
  type BatchOutcome,
} from './training-results';

const RESULT = {
  resultId: '0f8b6c1e-2d3a-4b5c-8d7e-9f0a1b2c3d4e',
  kind: 'pass',
  moveKey: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - e2e4',
  repertoireId: '1a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d',
  answeredAt: '2026-10-23T12:00:00.000Z',
};
const batchOf = (n: number): unknown[] =>
  Array.from({ length: n }, () => RESULT);
const issuesOf = (input: unknown): string[] => {
  const parsed = resultBatchSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};
const BAD_BATCH = TRAINING_REFUSALS.badBatch;

describe('resultBatchSchema', () => {
  it('parses a result, coercing its time', () => {
    expect(resultBatchSchema.parse([RESULT])).toEqual([
      { ...RESULT, answeredAt: new Date('2026-10-23T12:00:00.000Z') },
    ]);
  });

  it('strips a player id from the body', () => {
    expect(resultBatchSchema.parse([{ ...RESULT, playerId: 'x' }])[0]).toEqual({
      ...RESULT,
      answeredAt: new Date(RESULT.answeredAt),
    });
  });

  it('refuses an empty batch', () => {
    expect(issuesOf([])).toEqual([BAD_BATCH]);
  });

  it('accepts a batch of 200 and refuses 201', () => {
    expect(MAX_RESULT_BATCH).toBe(200);
    expect(resultBatchSchema.safeParse(batchOf(200)).success).toBe(true);
    expect(issuesOf(batchOf(201))).toEqual([BAD_BATCH]);
  });

  it.each([
    ['a bad result id', { resultId: 'nope' }],
    ['a bad repertoire id', { repertoireId: 'nope' }],
    ['an unknown kind', { kind: 'guess' }],
    ['a move key too short', { moveKey: 'ab' }],
    ['a move key too long', { moveKey: 'x'.repeat(201) }],
    ['a move key that is no string', { moveKey: 7 }],
    ['a time that is no date', { answeredAt: 'soon' }],
  ])('refuses %s with the badBatch key', (_, change) => {
    expect(issuesOf([{ ...RESULT, ...change }])).toEqual([BAD_BATCH]);
  });

  it.each([
    ['an object', { results: [RESULT] }],
    ['a result that is no object', ['x']],
    ['null', null],
  ])('refuses %s with the badBatch key', (_, input) => {
    expect(issuesOf(input)).toEqual([BAD_BATCH]);
  });

  it.each(['learned', 'pass', 'lapse', 'hint'])(
    'accepts the kind %s',
    (kind) => {
      expect(resultBatchSchema.safeParse([{ ...RESULT, kind }]).success).toBe(
        true,
      );
    },
  );
});

describe('isLogged', () => {
  it.each(['applied', 'stale'] as const)('logs a %s result', (status) => {
    expect(isLogged(status)).toBe(true);
  });

  it.each([
    TRAINING_REFUSALS.paused,
    TRAINING_REFUSALS.notLearned,
    TRAINING_REFUSALS.notTrained,
    TRAINING_REFUSALS.badBatch,
  ])('logs a result refused as %s', (reason) => {
    expect(isLogged({ reason })).toBe(true);
  });

  it('logs no result refused as notHeld: it names nothing the player holds', () => {
    expect(isLogged({ reason: TRAINING_REFUSALS.notHeld })).toBe(false);
  });

  it('logs no duplicate again', () => {
    expect(isLogged('duplicate')).toBe(false);
  });
});

describe('resultAnswer', () => {
  it.each(['applied', 'stale', 'duplicate'] as const)(
    'answers %s by its status',
    (status) => {
      expect(resultAnswer('id', status)).toStrictEqual({
        resultId: 'id',
        status,
      });
    },
  );

  it('answers a refusal with its reason', () => {
    expect(
      resultAnswer('id', { reason: TRAINING_REFUSALS.notHeld }),
    ).toStrictEqual({
      resultId: 'id',
      status: 'refused',
      reason: 'training.notHeld',
    });
  });
});

const headers = (contentType: string | null, contentLength: string | null) => ({
  contentType,
  contentLength,
});

describe('unreadRefusal', () => {
  it.each([
    'application/json',
    'Application/JSON; charset=utf-8',
    ' application/json ;charset=utf-8',
  ])('reads a body declared %s', (type) => {
    expect(unreadRefusal(headers(type, null))).toBeUndefined();
  });

  it.each([
    ['text/plain'],
    ['application/x-www-form-urlencoded'],
    ['application/jsonp'],
    [null],
  ])('refuses %s unread as not JSON', (type) => {
    expect(unreadRefusal(headers(type, '10'))).toEqual({ kind: 'notJson' });
  });

  it('checks the type before the length', () => {
    expect(unreadRefusal(headers('text/plain', String(1e9)))).toEqual({
      kind: 'notJson',
    });
  });

  it('refuses a body declared over 256 KB unread', () => {
    expect(MAX_BATCH_BODY_BYTES).toBe(256 * 1024);
    expect(
      unreadRefusal(headers('application/json', String(256 * 1024 + 1))),
    ).toEqual({ kind: 'tooLarge' });
  });

  it.each([String(256 * 1024), null, 'many'])(
    'reads a body declared %s long',
    (length) => {
      expect(
        unreadRefusal(headers('application/json', length)),
      ).toBeUndefined();
    },
  );
});

const ANSWERS = [
  { resultId: 'a', status: 'applied' },
  { resultId: 'b', status: 'refused', reason: 'training.notHeld' },
] as const;

describe('batchResponse', () => {
  it.each<[BatchOutcome, number, unknown]>([
    [{ kind: 'recorded', answers: ANSWERS }, 200, { answers: ANSWERS }],
    [{ kind: 'unauthenticated' }, 401, null],
    [{ kind: 'notOnboarded' }, 403, null],
    [
      { kind: 'rateLimited', reason: 'training.tooManyResults' },
      429,
      { reason: 'training.tooManyResults' },
    ],
    [{ kind: 'malformed' }, 400, { reason: BAD_BATCH }],
    [{ kind: 'tooLarge' }, 413, { reason: BAD_BATCH }],
    [{ kind: 'notJson' }, 415, { reason: BAD_BATCH }],
  ])('answers %o with %d', (outcome, status, body) => {
    expect(batchResponse(outcome)).toStrictEqual({ status, body });
  });
});

const BATCH = [{ resultId: 'a' }, { resultId: 'b' }, { resultId: 'c' }];

describe('settleFlush', () => {
  it('keeps the batch when the post failed', () => {
    expect(settleFlush(BATCH, undefined)).toStrictEqual({
      kind: 'kept',
      drop: new Set(),
    });
  });

  it.each([401, 429, 500, 502, 503, 404, 302])(
    'keeps the batch on a %d',
    (status) => {
      expect(
        settleFlush(BATCH, { status, body: { reason: BAD_BATCH } }),
      ).toStrictEqual({ kind: 'kept', drop: new Set() });
    },
  );

  it.each([400, 403, 413, 415])(
    'drops the whole batch on a %d, as it can never be recorded',
    (status) => {
      expect(settleFlush(BATCH, { status, body: null })).toStrictEqual({
        kind: 'batchRefused',
        status,
        drop: new Set(['a', 'b', 'c']),
      });
    },
  );

  it('drops each answered result, and names the refused ones by reason', () => {
    expect(
      settleFlush(BATCH, {
        status: 200,
        body: {
          answers: [
            ...ANSWERS,
            { resultId: 'z', status: 'duplicate' },
            { resultId: 'y', status: 'refused', reason: 'training.paused' },
          ],
        },
      }),
    ).toStrictEqual({
      kind: 'answered',
      drop: new Set(['a', 'b', 'z', 'y']),
      refused: ['training.notHeld', 'training.paused'],
    });
  });

  it('reads a refusal reason it does not know', () => {
    expect(
      settleFlush(BATCH, {
        status: 200,
        body: {
          answers: [{ resultId: 'a', status: 'refused', reason: 'later.new' }],
        },
      }),
    ).toStrictEqual({
      kind: 'answered',
      drop: new Set(['a']),
      refused: ['later.new'],
    });
  });

  it.each([
    ['no body', undefined],
    ['no answers', {}],
    ['an unknown status', { answers: [{ resultId: 'a', status: 'lost' }] }],
    [
      'a refusal without a reason',
      { answers: [{ resultId: 'a', status: 'refused' }] },
    ],
  ])('keeps the batch on a 200 with %s', (_, body) => {
    expect(settleFlush(BATCH, { status: 200, body })).toStrictEqual({
      kind: 'kept',
      drop: new Set(),
    });
  });

  it('reads answers on any 2xx', () => {
    expect(
      settleFlush(BATCH, {
        status: 299,
        body: { answers: [{ resultId: 'a', status: 'stale' }] },
      }).drop,
    ).toStrictEqual(new Set(['a']));
  });

  it('round-trips what batchResponse answers', () => {
    const response = batchResponse({ kind: 'recorded', answers: ANSWERS });
    expect(settleFlush(BATCH, response).drop).toStrictEqual(
      new Set(['a', 'b']),
    );
    for (const kind of [
      'malformed',
      'tooLarge',
      'notJson',
      'notOnboarded',
    ] as const)
      expect(settleFlush(BATCH, batchResponse({ kind })).kind).toBe(
        'batchRefused',
      );
    for (const kind of ['unauthenticated'] as const)
      expect(settleFlush(BATCH, batchResponse({ kind })).kind).toBe('kept');
    expect(
      settleFlush(
        BATCH,
        batchResponse({
          kind: 'rateLimited',
          reason: 'training.tooManyResults',
        }),
      ).kind,
    ).toBe('kept');
  });
});
