/** What a named thing is ordered by: its name, then its id. */
interface NameAndId {
  readonly name: string;
  readonly id: string;
}

/**
 * The one order of named things the reads list (players, repertoires): by
 * name in Lithuanian order, then by id, so equal names keep a stable order.
 * `key` says where a listed thing keeps its name and id.
 */
export const byName =
  <T>(key: (one: T) => NameAndId) =>
  (a: T, b: T): number => {
    const x = key(a);
    const y = key(b);
    return x.name.localeCompare(y.name, 'lt') || x.id.localeCompare(y.id);
  };
