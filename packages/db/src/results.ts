// The Result values the repositories return. Internal to the package.
import type { Result } from '@mychess/domain';

/** The success of an action that returns nothing. */
export const DONE: Result<undefined, never> = { ok: true, value: undefined };

/** A refusal for `reason`, a message-catalogue key the UI translates. */
export const refusal = <R extends string>(
  reason: R,
): Result<never, { readonly reason: R }> => ({
  ok: false,
  refusal: { reason },
});
