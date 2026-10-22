import { RATE_LIMIT_RETENTION_MS } from '@mychess/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pruneRateLimits } from '../src';
import { runRateLimitsPrune } from '../src/bin/rate-limits-command';
import { useTestDatabase } from '../src/testing';

const { db, client, url } = useTestDatabase();

const NOW = new Date('2026-10-22T08:00:00Z');
/** The oldest last_request a prune at NOW keeps. */
const CUTOFF = NOW.getTime() - RATE_LIMIT_RETENTION_MS;

async function seed(rows: Record<string, number>): Promise<void> {
  for (const [key, lastRequest] of Object.entries(rows)) {
    await client.query(
      'insert into rate_limits (id, key, count, last_request) values ($1, $1, 1, $2)',
      [key, lastRequest],
    );
  }
}

const keys = async (): Promise<string[]> =>
  (
    await client.query<{ key: string }>(
      'select key from rate_limits order by key',
    )
  ).rows.map((r) => r.key);

describe('pruneRateLimits', () => {
  it('deletes rows older than the longest window and keeps the rest', async () => {
    await seed({
      ancient: 0,
      'just-old': CUTOFF - 1,
      boundary: CUTOFF,
      recent: NOW.getTime() - 1,
      future: NOW.getTime() + 1000,
    });
    expect(await pruneRateLimits(db, NOW)).toBe(2);
    expect(await keys()).toEqual(['boundary', 'future', 'recent']);
  });

  it('deletes nothing from an empty or fresh table', async () => {
    expect(await pruneRateLimits(db, NOW)).toBe(0);
    await seed({ fresh: NOW.getTime() });
    expect(await pruneRateLimits(db, NOW)).toBe(0);
    expect(await keys()).toEqual(['fresh']);
  });
});

describe('runRateLimitsPrune', () => {
  let out: string[];

  beforeEach(() => {
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('prunes the database in DATABASE_URL and reports how many rows', async () => {
    vi.stubEnv('DATABASE_URL', url);
    await seed({ old: CUTOFF - 1, kept: CUTOFF });
    await runRateLimitsPrune(NOW);
    expect(out).toEqual(['rate-limits: pruned 1\n']);
    expect(await keys()).toEqual(['kept']);
  });

  it('prunes as of the current time by default', async () => {
    vi.stubEnv('DATABASE_URL', url);
    const now = Date.now();
    await seed({ old: now - RATE_LIMIT_RETENTION_MS - 60_000, kept: now });
    await runRateLimitsPrune();
    expect(out).toEqual(['rate-limits: pruned 1\n']);
    expect(await keys()).toEqual(['kept']);
  });

  it('refuses to run without a database URL', async () => {
    vi.stubEnv('DATABASE_URL', undefined);
    await expect(runRateLimitsPrune(NOW)).rejects.toThrow(/DATABASE_URL/);
    expect(out).toEqual([]);
  });
});
