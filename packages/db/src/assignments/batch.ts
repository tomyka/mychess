/**
 * Batch sizes for the set-based writes of a change, under Postgres's 65,535
 * bind parameters per statement. Internal to the package.
 */

/** Fork offers per insert: about nine parameters each. */
export const FORK_OFFER_CHUNK = 1_000;

/** `list` in consecutive runs of at most `size`, in order; none for none. */
export const chunksOf = <T>(list: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, (i + 1) * size),
  );
