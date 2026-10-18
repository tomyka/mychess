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

export async function createDatabase(
  serverUrl: string,
  name: string,
): Promise<void> {
  await onServer(serverUrl, (client) =>
    client.query(`create database ${client.escapeIdentifier(name)}`),
  );
}

/** Drops `name`, closing any connection still open to it. */
export async function dropDatabase(
  serverUrl: string,
  name: string,
): Promise<void> {
  await onServer(serverUrl, (client) =>
    client.query(
      `drop database if exists ${client.escapeIdentifier(name)} with (force)`,
    ),
  );
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
