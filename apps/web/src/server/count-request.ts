import type { RateRefusal, RateRule, Result } from '@mychess/domain';

/**
 * Counts a request for `key` under `rule` at `now`: allowed (and counted)
 * or refused with the rule's reason. The db's countRateLimited on this
 * process's database (fide-services.ts); a fake in the use cases' tests.
 */
export type CountRequest = <R extends string>(
  key: string,
  rule: RateRule<R>,
  now: Date,
) => Promise<Result<undefined, RateRefusal<R>>>;
