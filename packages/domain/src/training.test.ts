import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRAINING_SETTINGS,
  MAX_RESULT_BATCH,
  RESULT_MAX_AGE_MS,
  SECONDS_PER_REVIEW,
  acceptResult,
  canRecord,
  clampAnsweredAt,
  learnOrder,
  resultBatchSchema,
  trainingSettingsSchema,
  type TrainingEntry,
} from './training';

const issuesOf = (input: unknown): string[] => {
  const parsed = trainingSettingsSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};

describe('trainingSettingsSchema', () => {
  it.each([10, 100])('accepts a session size of %d (R-62)', (sessionSize) => {
    expect(
      trainingSettingsSchema.parse({ sessionSize, newPerDay: 10 }),
    ).toEqual({
      sessionSize,
      newPerDay: 10,
    });
  });

  it.each([9, 101, 20.5])('refuses a session size of %d', (sessionSize) => {
    expect(issuesOf({ sessionSize, newPerDay: 10 })).toEqual([
      'training.settings.sessionSize',
    ]);
  });

  it.each([0, 50])('accepts %d new moves a day (R-146)', (newPerDay) => {
    expect(
      trainingSettingsSchema.parse({ sessionSize: 20, newPerDay }),
    ).toEqual({
      sessionSize: 20,
      newPerDay,
    });
  });

  it.each([-1, 51, 2.5])('refuses %d new moves a day', (newPerDay) => {
    expect(issuesOf({ sessionSize: 20, newPerDay })).toEqual([
      'training.settings.newPerDay',
    ]);
  });

  it('refuses a value that is not a number with its key', () => {
    expect(issuesOf({ sessionSize: 'many', newPerDay: 'some' })).toEqual([
      'training.settings.sessionSize',
      'training.settings.newPerDay',
    ]);
  });

  it('coerces the strings a form posts', () => {
    expect(
      trainingSettingsSchema.parse({ sessionSize: '20', newPerDay: '5' }),
    ).toEqual({ sessionSize: 20, newPerDay: 5 });
  });

  it('defaults to 20 a session and 10 new a day, within the limits', () => {
    expect(DEFAULT_TRAINING_SETTINGS).toEqual({
      sessionSize: 20,
      newPerDay: 10,
    });
    expect(trainingSettingsSchema.parse(DEFAULT_TRAINING_SETTINGS)).toEqual(
      DEFAULT_TRAINING_SETTINGS,
    );
  });
});

describe('SECONDS_PER_REVIEW', () => {
  it('estimates eight seconds per due move', () => {
    expect(SECONDS_PER_REVIEW).toBe(8);
  });
});

const RESULT = {
  resultId: '7d3f2b1e-4c5a-4f6b-8a9c-0d1e2f3a4b5c',
  kind: 'pass',
  moveKey: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - e2e4',
  repertoireId: '1a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d',
  answeredAt: '2026-10-23T12:00:00.000Z',
};
const batchOf = (n: number): unknown[] =>
  Array.from({ length: n }, () => RESULT);

describe('resultBatchSchema', () => {
  it('parses a result, coercing its time', () => {
    expect(resultBatchSchema.parse([RESULT])).toEqual([
      { ...RESULT, answeredAt: new Date('2026-10-23T12:00:00.000Z') },
    ]);
  });

  it('refuses an empty batch', () => {
    expect(resultBatchSchema.safeParse([]).success).toBe(false);
  });

  it('accepts a batch of 200 and refuses 201', () => {
    expect(MAX_RESULT_BATCH).toBe(200);
    expect(resultBatchSchema.safeParse(batchOf(200)).success).toBe(true);
    expect(resultBatchSchema.safeParse(batchOf(201)).success).toBe(false);
  });

  it.each([
    ['a bad result id', { resultId: 'nope' }],
    ['a bad repertoire id', { repertoireId: 'nope' }],
    ['an unknown kind', { kind: 'guess' }],
    ['a move key too short', { moveKey: 'ab' }],
    ['a move key too long', { moveKey: 'x'.repeat(201) }],
    ['a time that is no date', { answeredAt: 'soon' }],
  ])('refuses %s', (_, change) => {
    expect(
      resultBatchSchema.safeParse([{ ...RESULT, ...change }]).success,
    ).toBe(false);
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

describe('clampAnsweredAt', () => {
  const now = new Date('2026-10-23T12:00:00Z');

  it('keeps a result window of seven days', () => {
    expect(RESULT_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('clamps a time in the future to now', () => {
    expect(clampAnsweredAt(new Date('2026-10-23T12:00:01Z'), now)).toEqual(now);
  });

  it('clamps a time more than seven days back to seven days back', () => {
    expect(clampAnsweredAt(new Date('2026-10-01T00:00:00Z'), now)).toEqual(
      new Date('2026-10-16T12:00:00Z'),
    );
  });

  it.each([
    '2026-10-16T12:00:00Z',
    '2026-10-20T08:30:00Z',
    '2026-10-23T12:00:00Z',
  ])('keeps %s, inside the window', (at) => {
    expect(clampAnsweredAt(new Date(at), now)).toEqual(new Date(at));
  });
});

describe('canRecord', () => {
  it('refuses a repertoire the player does not train now', () => {
    expect(canRecord('pass', { repertoire: undefined })).toEqual({
      ok: false,
      refusal: { reason: 'training.notHeld' },
    });
  });

  it('refuses a repertoire that does not hold the move', () => {
    expect(
      canRecord('pass', { repertoire: { active: true, holds: false } }),
    ).toEqual({ ok: false, refusal: { reason: 'training.notHeld' } });
  });

  it('refuses learning a move of a paused repertoire', () => {
    expect(
      canRecord('learned', { repertoire: { active: false, holds: true } }),
    ).toEqual({ ok: false, refusal: { reason: 'training.paused' } });
  });

  it.each(['pass', 'lapse', 'hint'] as const)(
    'records a %s on a paused repertoire: the answer was given',
    (kind) => {
      expect(
        canRecord(kind, { repertoire: { active: false, holds: true } }),
      ).toEqual({ ok: true, value: undefined });
    },
  );

  it('records learning a move of an active repertoire', () => {
    expect(
      canRecord('learned', { repertoire: { active: true, holds: true } }),
    ).toEqual({ ok: true, value: undefined });
  });
});

describe('acceptResult', () => {
  const at = new Date('2026-10-23T12:00:00Z');
  const row = (lastReview: string) =>
    ({ exists: true, lastReview: new Date(lastReview) }) as const;

  it('applies a learned move that has no review yet', () => {
    expect(acceptResult('learned', at, { exists: false })).toEqual({
      ok: true,
      value: 'apply',
    });
  });

  it('keeps a learned move that already has a review as stale', () => {
    expect(acceptResult('learned', at, row('2026-10-01T00:00:00Z'))).toEqual({
      ok: true,
      value: 'stale',
    });
  });

  it.each(['pass', 'lapse', 'hint'] as const)(
    'refuses a %s for a move not learned',
    (kind) => {
      expect(acceptResult(kind, at, { exists: false })).toEqual({
        ok: false,
        refusal: { reason: 'training.notLearned' },
      });
    },
  );

  it('keeps a result earlier than the last review as stale', () => {
    expect(acceptResult('lapse', at, row('2026-10-23T12:00:00.001Z'))).toEqual({
      ok: true,
      value: 'stale',
    });
  });

  it.each(['2026-10-23T12:00:00Z', '2026-10-23T11:59:59.999Z'])(
    'applies a result at or after the last review (%s)',
    (lastReview) => {
      expect(acceptResult('pass', at, row(lastReview))).toEqual({
        ok: true,
        value: 'apply',
      });
    },
  );
});

describe('learnOrder', () => {
  interface Named extends TrainingEntry {
    readonly name: string;
  }
  const own = (position: number): Named => ({
    kind: 'own',
    deadline: null,
    position,
    name: `own ${String(position)}`,
  });
  const assigned = (position: number, deadline: string | null): Named => ({
    kind: 'assigned',
    deadline,
    position,
    name: `assigned ${String(position)}`,
  });

  it('teaches deadline assignments earliest first, then other assignments, then own (R-145)', () => {
    const entries = [
      own(0),
      assigned(1, null),
      assigned(2, '2026-11-01'),
      assigned(3, '2026-10-30'),
    ];
    expect(learnOrder(entries).map((e) => e.position)).toEqual([3, 2, 1, 0]);
  });

  it('keeps the entries it is given, with their own fields', () => {
    expect(learnOrder([own(0)])).toEqual([own(0)]);
  });

  it('breaks a tie in rank and deadline by position', () => {
    expect(
      learnOrder([
        own(5),
        own(4),
        assigned(3, null),
        assigned(2, null),
        assigned(1, '2026-11-01'),
        assigned(0, '2026-11-01'),
      ]).map((e) => e.position),
    ).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('does not reorder the array it is given', () => {
    const entries = [own(0), assigned(1, null)];
    learnOrder(entries);
    expect(entries.map((e) => e.position)).toEqual([0, 1]);
  });
});
