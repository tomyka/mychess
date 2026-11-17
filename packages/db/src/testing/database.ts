import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import { z } from 'zod';
import { connect, type Db } from '../client';
import { databaseUrlSchema } from '../config';
import { MIGRATIONS_FOLDER, runMigrations } from '../migrations';
import {
  createDatabase,
  databaseNameOf,
  databaseUrlOn,
  dropDatabase,
  ensureDatabaseCopy,
  freshDatabaseName,
  testServerUrl,
  workerDatabaseName,
} from './server-database';

/** The Postgres image every test suite runs on, bumped deliberately. */
const POSTGRES_IMAGE = 'postgres:18.6';

declare module 'vitest' {
  export interface ProvidedContext {
    /**
     * The migrated database a suite's global setup started: the template
     * each vitest worker copies its own database from (R-211). No test file
     * connects to it.
     */
    templateDatabaseUrl: string;
  }
}

export interface TestDatabase {
  readonly url: string;
  /** Drops the database or stops its container. Safe to call more than once. */
  readonly stop: () => Promise<void>;
}

/**
 * A migrated, empty Postgres database. A global setup starts one and hands
 * its `url` to the test files as the template their workers copy
 * (`project.provide('templateDatabaseUrl', database.url)`).
 *
 * With `TEST_POSTGRES_URL` set (an admin URL to a long-lived server, such as
 * infra/compose.yaml's), it is a fresh database on that server, dropped with
 * the workers' copies of it by `stop`; otherwise a throwaway Testcontainers
 * container.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const serverUrl = testServerUrl(process.env);
  return serverUrl === undefined
    ? startContainerDatabase()
    : startServerDatabase(serverUrl);
}

/**
 * A throwaway container needs no durability, and the workers running in
 * parallel (R-211) would otherwise wait on every fsync and on the checkpoint
 * each DROP DATABASE forces.
 */
const WITHOUT_DURABILITY = [
  'postgres',
  ...['fsync', 'synchronous_commit', 'full_page_writes'].flatMap((name) => [
    '-c',
    `${name}=off`,
  ]),
];

async function startContainerDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCommand(WITHOUT_DURABILITY)
    .start();
  return migrated(container.getConnectionUri(), () => container.stop());
}

async function startServerDatabase(serverUrl: string): Promise<TestDatabase> {
  const name = freshDatabaseName();
  await createDatabase(serverUrl, name);
  return migrated(databaseUrlOn(serverUrl, name), () =>
    dropDatabase(serverUrl, name),
  );
}

/**
 * Migrates the database at `url` and pairs it with a `stop` that runs
 * `release` once, however often it is called. A database that never gets
 * migrated is released at once rather than leaked past setup.
 */
async function migrated(
  url: string,
  release: () => Promise<unknown>,
): Promise<TestDatabase> {
  let stopping: Promise<unknown> | undefined;
  const stop = async () => {
    stopping ??= release();
    await stopping;
  };
  try {
    await runMigrations(url, MIGRATIONS_FOLDER);
  } catch (error) {
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
 * Connects this test file to its vitest worker's own copy of the suite's
 * template (`templateDatabaseUrl`), made by the worker's first file, empties
 * every table before each test and closes the connection after the last.
 * Files on other workers run at the same time on other copies, so they never
 * see this file's rows (R-211). Call it once, at the top of the file.
 */
export function useTestDatabase(): TestDatabaseConnection {
  const templateUrl = providedDatabaseUrl(inject('templateDatabaseUrl'));
  const url = workerDatabaseUrl(templateUrl, process.env['VITEST_POOL_ID']);
  const { db, pool } = connect(url);
  beforeAll(() => ensureDatabaseCopy(templateUrl, databaseNameOf(url)));
  beforeEach(() => truncateAll(db));
  afterAll(() => pool.end());
  return { url, db, client: pool };
}

const poolIdSchema = z.string().regex(/^[1-9][0-9]*$/);

/**
 * The URL of the copy of `templateUrl` that the vitest worker `poolId`
 * (`VITEST_POOL_ID`, unique among the workers running at once) uses.
 */
export function workerDatabaseUrl(
  templateUrl: string,
  poolId: unknown,
): string {
  const id = poolIdSchema.safeParse(poolId);
  if (!id.success) {
    throw new Error(
      'useTestDatabase: VITEST_POOL_ID is not a vitest pool id; run the file under vitest',
    );
  }
  return databaseUrlOn(
    templateUrl,
    workerDatabaseName(databaseNameOf(templateUrl), id.data),
  );
}

/**
 * The `templateDatabaseUrl` a global setup provided, or a refusal. Never
 * lets pg fall back to PG* variables or localhost: whatever the file
 * connects to, it truncates.
 */
export function providedDatabaseUrl(provided: unknown): string {
  const url = databaseUrlSchema.safeParse(provided);
  if (!url.success) {
    throw new Error(
      'useTestDatabase: no Postgres templateDatabaseUrl was provided; the suite needs a globalSetup that calls startTestDatabase and provides its url as templateDatabaseUrl',
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
