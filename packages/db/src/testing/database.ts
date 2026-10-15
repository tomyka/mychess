import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeEach, inject } from 'vitest';
import { z } from 'zod';
import { connect, type Db } from '../client';
import { databaseUrlSchema } from '../config';
import {
  MIGRATIONS_FOLDER,
  POSTGRES_IMAGE,
  runMigrations,
} from '../migrations';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The migrated test database a suite's global setup started. */
    databaseUrl: string;
  }
}

export interface TestDatabase {
  readonly url: string;
  /** Stops the container. Safe to call more than once. */
  readonly stop: () => Promise<void>;
}

/**
 * A migrated, empty Postgres in a throwaway container. A global setup
 * starts one and hands its `url` to the test files as `databaseUrl`
 * (`project.provide('databaseUrl', database.url)`).
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  let stopping: Promise<unknown> | undefined;
  const stop = async () => {
    stopping ??= container.stop();
    await stopping;
  };
  const url = container.getConnectionUri();
  try {
    await runMigrations(url, MIGRATIONS_FOLDER);
  } catch (error) {
    // A container that starts but never gets used must not leak past setup.
    await stop();
    throw error;
  }
  return { url, stop };
}

export interface TestDatabaseConnection {
  readonly url: string;
  readonly db: Db;
  /** Raw SQL on the same pool as `db`, for what drizzle cannot express. */
  readonly client: pg.Pool;
}

/**
 * Connects this test file to the suite's database (`databaseUrl`), empties
 * every table before each test and closes the connection after the last.
 * Call it once, at the top of the file.
 */
export function useTestDatabase(): TestDatabaseConnection {
  const url = providedDatabaseUrl(inject('databaseUrl'));
  const { db, pool } = connect(url);
  beforeEach(() => truncateAll(db));
  afterAll(() => pool.end());
  return { url, db, client: pool };
}

/**
 * The `databaseUrl` a global setup provided, or a refusal. Never lets pg
 * fall back to PG* variables or localhost: whatever the file connects to,
 * it truncates.
 */
export function providedDatabaseUrl(provided: unknown): string {
  const url = databaseUrlSchema.safeParse(provided);
  if (!url.success) {
    throw new Error(
      'useTestDatabase: no Postgres databaseUrl was provided; the suite needs a globalSetup that calls startTestDatabase and provides its url as databaseUrl',
    );
  }
  return url.data;
}

const tableNames = z.array(z.object({ name: z.string() }));

/**
 * Empties every table in `public`, with CASCADE. Destructive and unscoped
 * by design: `db` is only ever a test container's connection.
 */
async function truncateAll(db: Db): Promise<void> {
  const result = await db.execute(
    sql`select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public'`,
  );
  const names = tableNames.parse(result.rows).map((row) => row.name);
  if (names.length === 0) return;
  await db.execute(
    sql.raw(`truncate table ${names.join(', ')} restart identity cascade`),
  );
}
