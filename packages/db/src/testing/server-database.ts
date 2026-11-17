import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import { databaseUrlSchema } from '../config';

const testServerEnvSchema = z.object({
  TEST_POSTGRES_URL: databaseUrlSchema.optional(),
});

/**
 * The admin URL of a long-lived Postgres to create test databases on, from
 * `TEST_POSTGRES_URL`; undefined when the variable is unset. Anything set
 * but not a Postgres URL is refused, never ignored: the caller would
 * otherwise start a container the developer meant to avoid.
 */
export function testServerUrl(env: unknown): string | undefined {
  const parsed = testServerEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      'TEST_POSTGRES_URL is not a postgres:// URL; set it to an admin URL of a running Postgres, or unset it to use a Testcontainers Postgres',
    );
  }
  return parsed.data.TEST_POSTGRES_URL;
}

/** A database name no other run on the same server will pick. */
export function freshDatabaseName(): string {
  return `test_${randomBytes(8).toString('hex')}`;
}

/** The URL of database `name` on the server `serverUrl` points at. */
export function databaseUrlOn(serverUrl: string, name: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/** The name of the database `url` points at. */
export function databaseNameOf(url: string): string {
  return new URL(url).pathname.slice(1);
}

/** The name of the server's maintenance database, there on every Postgres. */
const MAINTENANCE_DATABASE = 'postgres';

const databaseNames = z.array(z.object({ name: z.string() }));

/** The name of the database the vitest worker `poolId` copies `template` to. */
export function workerDatabaseName(template: string, poolId: string): string {
  return `${template}_w${poolId}`;
}

export async function createDatabase(
  serverUrl: string,
  name: string,
): Promise<void> {
  await onServer(serverUrl, (client) =>
    client.query(`create database ${client.escapeIdentifier(name)}`),
  );
}

/**
 * Creates `copy` from `template` on the server of `templateUrl`, unless it
 * exists already: a worker's later files reuse the copy its first file made.
 * Only that worker ever creates `copy`, so the check cannot race. Nobody may
 * be connected to the template meanwhile, so the template's own URL is
 * never handed to a test file.
 */
export async function ensureDatabaseCopy(
  templateUrl: string,
  copy: string,
): Promise<void> {
  const template = databaseNameOf(templateUrl);
  await onServer(
    databaseUrlOn(templateUrl, MAINTENANCE_DATABASE),
    async (client) => {
      const existing = await client.query(
        'select 1 from pg_database where datname = $1',
        [copy],
      );
      if (existing.rowCount !== 0) return;
      await client.query(
        `create database ${client.escapeIdentifier(copy)} template ${client.escapeIdentifier(template)}`,
      );
    },
  );
}

/**
 * Drops `name` and every worker copy of it, closing any connection still
 * open to them.
 */
export async function dropDatabase(
  serverUrl: string,
  name: string,
): Promise<void> {
  await onServer(serverUrl, async (client) => {
    const copies = await client.query(
      'select datname as name from pg_database where starts_with(datname, $1)',
      [workerDatabaseName(name, '')],
    );
    const names = databaseNames.parse(copies.rows).map((row) => row.name);
    for (const database of [...names, name]) {
      await client.query(
        `drop database if exists ${client.escapeIdentifier(database)} with (force)`,
      );
    }
  });
}

async function onServer(
  serverUrl: string,
  query: (client: pg.Client) => Promise<unknown>,
): Promise<void> {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    await query(client);
  } finally {
    await client.end();
  }
}
