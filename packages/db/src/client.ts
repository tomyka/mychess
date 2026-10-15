import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/** A transaction on a Db, as `db.transaction` hands it to its callback. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** What every repository function runs on: the database, or a transaction. */
export type Executor = Db | Tx;

export interface DbHandle {
  readonly db: Db;
  // A property of function type, not a method shorthand: the implementation
  // is an arrow function with no `this`, and a method signature here would
  // trip `@typescript-eslint/unbound-method` at every destructuring call site.
  readonly close: () => Promise<void>;
}

/**
 * A hardened pool and the Db over it. Not part of the package's entry point:
 * `createDb` is how runtime code connects, and the test database module
 * (src/testing) uses this to reach raw SQL with the same settings.
 */
export function connect(url: string): {
  readonly db: Db;
  readonly pool: pg.Pool;
} {
  const pool = new pg.Pool({
    connectionString: url,
    // A connection attempt that cannot complete fails instead of hanging a request.
    connectionTimeoutMillis: 5_000,
  });
  // An idle client whose server went away emits 'error' on the pool; without a
  // listener that is an uncaught exception and the whole process dies.
  pool.on('error', (error) => {
    console.error('database pool: idle client error', error);
  });
  return { db: drizzle({ client: pool, schema }), pool };
}

export function createDb(url: string): DbHandle {
  const { db, pool } = connect(url);
  return { db, close: () => pool.end() };
}

/** Resolves if the database answers a trivial query; rejects otherwise. */
export async function ping(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}
