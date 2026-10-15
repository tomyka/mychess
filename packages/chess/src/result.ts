/**
 * The outcome of an operation that may refuse: a value, or a refusal whose
 * `reason` is a message-catalogue key the UI translates.
 */
export type Result<T, R extends { reason: string }> =
  { ok: true; value: T } | { ok: false; refusal: R };
