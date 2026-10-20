import pg from 'pg';
import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../src/testing';

// TEST_POSTGRES_URL points startTestDatabase at a long-lived server. These
// tests use the server the suite's global setup already started (its
// `postgres` maintenance database), so they need no server of their own.
const serverUrl = (() => {
  const url = new URL(inject('databaseUrl'));
  url.pathname = '/postgres';
  return url.toString();
})();

async function onServer<T>(query: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    return await query(client);
  } finally {
    await client.end();
  }
}

const databaseExists = (name: string) =>
  onServer(async (client) => {
    const { rows } = await client.query(
      'select 1 from pg_database where datname = $1',
      [name],
    );
    return rows.length === 1;
  });

async function migrationCount(url: string): Promise<number> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ count: number }>(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    return rows[0]?.count ?? 0;
  } finally {
    await client.end();
  }
}

const databaseName = (database: TestDatabase) =>
  new URL(database.url).pathname.slice(1);

afterEach(() => {
  vi.unstubAllEnvs();
});

// Two databases are created and migrated here: the work the suite's global
// setup does once, so it gets a hook's budget (vitest.config.ts
// hookTimeout), not a plain test's 30 s. On a loaded Docker host the plain
// timeout ran out (#285).
const MIGRATING_TWICE = 120_000;

describe('startTestDatabase with TEST_POSTGRES_URL', () => {
  it(
    'creates a fresh migrated database per call on that server, and stop() drops it',
    async () => {
      vi.stubEnv('TEST_POSTGRES_URL', serverUrl);
      const first = await startTestDatabase();
      const second = await startTestDatabase();
      try {
        expect(first.url).not.toBe(second.url);
        for (const database of [first, second]) {
          const url = new URL(database.url);
          expect(url.host).toBe(new URL(serverUrl).host);
          expect(databaseName(database)).toMatch(/^test_[0-9a-f]{16}$/);
          expect(await databaseExists(databaseName(database))).toBe(true);
          expect(await migrationCount(database.url)).toBeGreaterThan(0);
        }
      } finally {
        await first.stop();
        await second.stop();
      }
      expect(await databaseExists(databaseName(first))).toBe(false);
      expect(await databaseExists(databaseName(second))).toBe(false);
    },
    MIGRATING_TWICE,
  );

  it('drops the database even with a connection still open, and stops more than once safely', async () => {
    vi.stubEnv('TEST_POSTGRES_URL', serverUrl);
    const database = await startTestDatabase();
    const open = new pg.Client({ connectionString: database.url });
    open.on('error', () => undefined);
    await open.connect();
    await database.stop();
    await expect(database.stop()).resolves.toBeUndefined();
    expect(await databaseExists(databaseName(database))).toBe(false);
    await open.end().catch(() => undefined);
  });

  it.each([
    ['an empty string', ''],
    ['a URL that is not Postgres', 'mysql://x@y/z'],
    ['text that is not a URL', 'localhost:5432'],
  ])('refuses %s, naming the variable', async (_, value) => {
    vi.stubEnv('TEST_POSTGRES_URL', value);
    await expect(startTestDatabase()).rejects.toThrow(/TEST_POSTGRES_URL/);
  });
});
