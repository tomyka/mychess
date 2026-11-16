// A fake request counter (src/server/count-request.ts) for the use cases'
// tests: `calls` records each count and answers whether it is allowed or
// limited, or fails; the counter itself answers as countRateLimited does,
// a limited request refused with its rule's reason and limit.
import { vi } from 'vitest';
import type { RateRule } from '@mychess/domain';
import type { CountRequest } from '../../src/server/count-request';

export interface FakeCounter {
  readonly count: CountRequest;
  readonly calls: ReturnType<
    typeof vi.fn<
      (key: string, rule: RateRule, now: Date) => Promise<'allowed' | 'limited'>
    >
  >;
}

export function fakeCounter(): FakeCounter {
  const calls =
    vi.fn<
      (key: string, rule: RateRule, now: Date) => Promise<'allowed' | 'limited'>
    >();
  calls.mockResolvedValue('allowed');
  return {
    calls,
    count: async (key, rule, now) =>
      (await calls(key, rule, now)) === 'limited'
        ? { ok: false, refusal: { reason: rule.reason, limit: rule.max } }
        : { ok: true, value: undefined },
  };
}
