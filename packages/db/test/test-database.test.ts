import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import { createDb, databaseEnvSchema, type Db, ping } from '../src';
import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrations';
import { startTestDatabase, useTestDatabase } from '../src/testing';
import {
  providedDatabaseUrl,
  workerDatabaseUrl,
} from '../src/testing/database';

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

// Each vitest worker runs its files on its own copy of the template the
// global setup migrated (R-211), so files on other workers never see its rows.
describe('workerDatabaseUrl', () => {
  it('names the copy after the template and the pool id, on the same server', () => {
    expect(
      workerDatabaseUrl('postgres://u:p@db.test:5432/test_ab12', '3'),
    ).toBe('postgres://u:p@db.test:5432/test_ab12_w3');
  });

  it.each([
    ['nothing', undefined],
    ['an empty string', ''],
    ['zero', '0'],
    ['text that is not a number', 'one'],
  ])('refuses %s as the pool id, naming VITEST_POOL_ID', (_, poolId) => {
    expect(() =>
      workerDatabaseUrl('postgres://u:p@db.test:5432/test', poolId),
    ).toThrow(/VITEST_POOL_ID/);
  });
});

describe('the test database', () => {
  it("is this worker's own copy of the suite's template", async () => {
    const template = new URL(inject('templateDatabaseUrl')).pathname.slice(1);
    const { rows } = await connection.client.query<{ name: string }>(
      'select current_database() as name',
    );
    const poolId = process.env['VITEST_POOL_ID'] ?? '';
    expect(rows).toEqual([{ name: `${template}_w${poolId}` }]);
  });

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

// The settings a container runs with, durability's three.
const durabilitySettings = (db: Db) =>
  db.execute(
    sql`select name, setting from pg_settings where name in ('fsync', 'full_page_writes', 'synchronous_commit') order by name`,
  );

describe('startTestDatabase', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // A throwaway container needs no durability, and the workers running in
  // parallel (R-211) would wait on every fsync and on the checkpoint each
  // DROP DATABASE forces.
  it(
    'starts a Postgres container without durability that answers, and stops it more than once safely',
    { timeout: 120_000 },
    async () => {
      vi.stubEnv('TEST_POSTGRES_URL', undefined);
      const database = await startTestDatabase();
      const { db, close } = createDb(database.url);
      try {
        await expect(ping(db)).resolves.toBeUndefined();
        expect((await durabilitySettings(db)).rows).toEqual([
          { name: 'fsync', setting: 'off' },
          { name: 'full_page_writes', setting: 'off' },
          { name: 'synchronous_commit', setting: 'off' },
        ]);
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
