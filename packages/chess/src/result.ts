/**
 * The outcome of an operation that may refuse: a value, or a refusal whose
 * `reason` is a message-catalogue key the UI translates.
 */
export type Result<T, R extends { reason: string }> =
  { ok: true; value: T } | { ok: false; refusal: R };

/** A success: with no value for an action that returns nothing. */
export function ok(): Result<undefined, never>;
/** A success carrying `value`. */
export function ok<T>(value: T): Result<T, never>;
export function ok<T>(value?: T): Result<T | undefined, never> {
  return { ok: true, value };
}

/** A refusal for `reason`, a message-catalogue key the UI translates. */
export function refuse<R extends string>(
  reason: R,
): Result<never, { readonly reason: R }>;
/** A refusal for `reason` with the details its message needs (a limit). */
export function refuse<R extends string, D extends object>(
  reason: R,
  details: D,
): Result<never, { readonly reason: R } & D>;
export function refuse<R extends string>(
  reason: R,
  details: object = {},
): Result<never, { readonly reason: R }> {
  return { ok: false, refusal: { ...details, reason } };
}
