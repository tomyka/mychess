import { describe, expect, it } from 'vitest';
import { createDb, databaseEnvSchema, ping } from '../src';
import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrations';
import { startTestDatabase, useTestDatabase } from '../src/testing';
import { providedDatabaseUrl } from '../src/testing/database';

const connection = useTestDatabase();

const countScratchRows = async () =>
  (
    await connection.client.query<{ rows: number }>(
      'select count(*)::int as rows from scratch',
    )
  ).rows;

// useTestDatabase truncates whatever it connects to: without a provided URL,
// pg would fall back to PG* variables or localhost, so it must refuse.
describe('providedDatabaseUrl', () => {
  it('passes a Postgres URL through', () => {
    const url = 'postgres://test:test@127.0.0.1:5432/test';
    expect(providedDatabaseUrl(url)).toBe(url);
  });

  it.each([
    ['nothing', undefined],
    ['an empty string', ''],
    ['a URL that is not Postgres', 'mysql://x@y/z'],
  ])('refuses %s, naming the global setup', (_, provided) => {
    expect(() => providedDatabaseUrl(provided)).toThrow(/startTestDatabase/);
  });
});

describe('the test database', () => {
  it('is migrated: drizzle has its journal table', async () => {
    const { rows } = await connection.client.query(
      "select to_regclass('drizzle.__drizzle_migrations') is not null as migrated",
    );
    expect(rows).toEqual([{ migrated: true }]);
  });

  it('answers a ping through createDb, and closes', async () => {
    const { db, close } = createDb(connection.url);
    await expect(ping(db)).resolves.toBeUndefined();
    await close();
  });

  it('takes the migrations again without change', async () => {
    await expect(
      runMigrations(connection.url, MIGRATIONS_FOLDER),
    ).resolves.toBeUndefined();
  });

  // The next two tests run in order (the root config never shuffles): the
  // first leaves a row behind, the second sees it gone.
  it('keeps the rows a test writes until it ends', async () => {
    await connection.client.query('create table scratch (id int)');
    await connection.client.query('insert into scratch values (1)');
    expect(await countScratchRows()).toEqual([{ rows: 1 }]);
  });

  it('empties every table before the next test', async () => {
    expect(await countScratchRows()).toEqual([{ rows: 0 }]);
    await connection.client.query('drop table scratch');
  });
});

describe('startTestDatabase', () => {
  it(
    'starts a Postgres that answers, and stops it more than once safely',
    { timeout: 120_000 },
    async () => {
      const database = await startTestDatabase();
      const { db, close } = createDb(database.url);
      try {
        await expect(ping(db)).resolves.toBeUndefined();
      } finally {
        await close();
      }
      await database.stop();
      await expect(database.stop()).resolves.toBeUndefined();
    },
  );
});

describe('databaseEnvSchema', () => {
  it('takes a postgresql:// DATABASE_URL', () => {
    const env = { DATABASE_URL: 'postgresql://u:p@db:5432/mychess' };
    expect(databaseEnvSchema.parse(env)).toEqual(env);
  });

  it('refuses an environment without DATABASE_URL', () => {
    expect(databaseEnvSchema.safeParse({}).success).toBe(false);
  });
});
