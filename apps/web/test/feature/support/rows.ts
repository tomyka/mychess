import type { TestDatabaseConnection } from '@mychess/db/testing';
import { z } from 'zod';

type Client = TestDatabaseConnection['client'];

const countRows = z.array(z.object({ n: z.number() }));
const idRows = z.array(z.object({ id: z.string() }));

export interface SqlHelpers {
  /** The rows `sql` selects. */
  readonly rows: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  /** How many rows `table` has; a `where` may follow the name. */
  readonly count: (table: string) => Promise<number>;
  /** The id of the account with `email`; throws if there is none. */
  readonly accountId: (email: string) => Promise<string>;
}

/** Raw-SQL readings of the test database on `client`. */
export function sqlOn(client: Client): SqlHelpers {
  const rows = async (sql: string, params: unknown[] = []) =>
    (await client.query<Record<string, unknown>>(sql, params)).rows;
  return {
    rows,
    count: async (table) =>
      countRows.parse(await rows(`select count(*)::int as n from ${table}`))[0]
        ?.n ?? 0,
    accountId: async (email) => {
      const [row] = idRows.parse(
        await rows('select id from accounts where email = $1', [email]),
      );
      if (row === undefined) throw new Error(`no account ${email}`);
      return row.id;
    },
  };
}
