import {
  BROADCAST_LINK_RATE_LIMIT,
  FIDE_SEARCH_RATE_LIMIT,
  IMPORT_RATE_LIMIT,
  MAGIC_LINK_EMAIL_RATE_LIMIT,
  MAGIC_LINK_RATE_LIMIT,
  TRAINING_RATE_LIMIT,
  TRAINING_RESULTS_RATE_LIMIT,
  broadcastLinkRateKey,
  countRequest,
} from '@mychess/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pruneRateLimits } from '../src';
import { runRateLimitsPrune } from '../src/bin/rate-limits-command';
import {
  BETTER_AUTH_RETENTION_MS,
  BROADCAST_LINK_COUNTER_RETENTION,
  REQUEST_COUNTER_RETENTION_MS,
} from '../src/rate-limits';
import { useTestDatabase } from '../src/testing';

const { db, client, url } = useTestDatabase();

const NOW = new Date('2026-10-22T08:00:00Z');
/** The oldest last_request a prune at NOW keeps in rate_limits. */
const AUTH_CUTOFF = NOW.getTime() - BETTER_AUTH_RETENTION_MS;
/** The oldest window_start a prune at NOW keeps in request_counters. */
const COUNTER_CUTOFF = NOW.getTime() - REQUEST_COUNTER_RETENTION_MS;

/** Better Auth's rows: key and last request. */
async function seedAuth(rows: Record<string, number>): Promise<void> {
  for (const [key, lastRequest] of Object.entries(rows)) {
    await client.query(
      'insert into rate_limits (id, key, count, last_request) values ($1, $1, 1, $2)',
      [key, lastRequest],
    );
  }
}

/** Our counters: key and window start. */
async function seedCounters(rows: Record<string, number>): Promise<void> {
  for (const [key, windowStart] of Object.entries(rows)) {
    await client.query(
      'insert into request_counters (key, count, window_start) values ($1, 1, $2)',
      [key, windowStart],
    );
  }
}

const keysOf = async (table: string): Promise<string[]> =>
  (
    await client.query<{ key: string }>(`select key from ${table} order by key`)
  ).rows.map((r) => r.key);

describe('the retention of each table', () => {
  it("keeps Better Auth's rows for its longest window: a minute", () => {
    expect(BETTER_AUTH_RETENTION_MS).toBe(60_000);
    expect(BETTER_AUTH_RETENTION_MS).toBeGreaterThanOrEqual(
      MAGIC_LINK_RATE_LIMIT.windowMs,
    );
  });

  it('keeps our counters for their longest window: the hour of the per-email magic-link limit', () => {
    expect(REQUEST_COUNTER_RETENTION_MS).toBe(3_600_000);
    expect(REQUEST_COUNTER_RETENTION_MS).toBe(
      MAGIC_LINK_EMAIL_RATE_LIMIT.windowMs,
    );
    expect(REQUEST_COUNTER_RETENTION_MS).toBeGreaterThanOrEqual(
      IMPORT_RATE_LIMIT.windowMs,
    );
    expect(REQUEST_COUNTER_RETENTION_MS).toBeGreaterThanOrEqual(
      TRAINING_RATE_LIMIT.windowMs,
    );
    expect(REQUEST_COUNTER_RETENTION_MS).toBeGreaterThanOrEqual(
      TRAINING_RESULTS_RATE_LIMIT.windowMs,
    );
    expect(REQUEST_COUNTER_RETENTION_MS).toBeGreaterThanOrEqual(
      FIDE_SEARCH_RATE_LIMIT.windowMs,
    );
  });

  it('keeps only the pasted broadcast link counters for their day (#349, architect 1)', () => {
    expect(BROADCAST_LINK_COUNTER_RETENTION).toEqual({
      prefix: 'broadcast-link:',
      retentionMs: 86_400_000,
    });
    expect(
      broadcastLinkRateKey('a').startsWith(
        BROADCAST_LINK_COUNTER_RETENTION.prefix,
      ),
    ).toBe(true);
    expect(BROADCAST_LINK_COUNTER_RETENTION.retentionMs).toBe(
      BROADCAST_LINK_RATE_LIMIT.windowMs,
    );
  });

  it('outlives every counter: one older counts like no counter at all', () => {
    const t0 = 1_000_000;
    const kept = [
      [MAGIC_LINK_EMAIL_RATE_LIMIT, REQUEST_COUNTER_RETENTION_MS],
      [BROADCAST_LINK_RATE_LIMIT, BROADCAST_LINK_COUNTER_RETENTION.retentionMs],
    ] as const;
    for (const [rule, retentionMs] of kept) {
      const now = t0 + retentionMs;
      const stale = { count: rule.max, windowStart: t0 };
      expect(countRequest(stale, rule, now)).toEqual(
        countRequest(undefined, rule, now),
      );
    }
  });
});

describe('pruneRateLimits by key prefix (#349, architect 1)', () => {
  const DAY_CUTOFF =
    NOW.getTime() - BROADCAST_LINK_COUNTER_RETENTION.retentionMs;

  it('keeps a pasted link counter for its day and every other counter for the hour', async () => {
    await seedCounters({
      'broadcast-link:hour-old': COUNTER_CUTOFF - 1,
      'broadcast-link:boundary': DAY_CUTOFF,
      'broadcast-link:day-old': DAY_CUTOFF - 1,
      'magic-link-email:hour-old': COUNTER_CUTOFF - 1,
      'fide-search:hour-old': COUNTER_CUTOFF - 1,
      'fide-search:boundary': COUNTER_CUTOFF,
    });
    expect(await pruneRateLimits(db, NOW)).toBe(3);
    expect(await keysOf('request_counters')).toEqual([
      'broadcast-link:boundary',
      'broadcast-link:hour-old',
      'fide-search:boundary',
    ]);
  });

  it('reads a key that only contains the prefix later as any other key', async () => {
    await seedCounters({ 'x-broadcast-link:a': COUNTER_CUTOFF - 1 });
    expect(await pruneRateLimits(db, NOW)).toBe(1);
  });
});

describe('pruneRateLimits', () => {
  it("deletes Better Auth's rows older than its longest window and keeps the rest", async () => {
    await seedAuth({
      ancient: 0,
      'just-old': AUTH_CUTOFF - 1,
      boundary: AUTH_CUTOFF,
      recent: NOW.getTime() - 1,
      future: NOW.getTime() + 1000,
    });
    expect(await pruneRateLimits(db, NOW)).toBe(2);
    expect(await keysOf('rate_limits')).toEqual([
      'boundary',
      'future',
      'recent',
    ]);
  });

  it('deletes our counters older than their longest window and keeps the rest', async () => {
    await seedCounters({
      ancient: 0,
      'just-old': COUNTER_CUTOFF - 1,
      boundary: COUNTER_CUTOFF,
      'past-auth-window': AUTH_CUTOFF - 1,
      future: NOW.getTime() + 1000,
    });
    expect(await pruneRateLimits(db, NOW)).toBe(2);
    expect(await keysOf('request_counters')).toEqual([
      'boundary',
      'future',
      'past-auth-window',
    ]);
  });

  it('reports the rows deleted from both tables together', async () => {
    await seedAuth({ old: AUTH_CUTOFF - 1 });
    await seedCounters({ old: COUNTER_CUTOFF - 1 });
    expect(await pruneRateLimits(db, NOW)).toBe(2);
  });

  it('deletes nothing from empty or fresh tables', async () => {
    expect(await pruneRateLimits(db, NOW)).toBe(0);
    await seedAuth({ fresh: NOW.getTime() });
    await seedCounters({ fresh: NOW.getTime() });
    expect(await pruneRateLimits(db, NOW)).toBe(0);
    expect(await keysOf('rate_limits')).toEqual(['fresh']);
    expect(await keysOf('request_counters')).toEqual(['fresh']);
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
    await seedAuth({ old: AUTH_CUTOFF - 1, kept: AUTH_CUTOFF });
    await seedCounters({ old: COUNTER_CUTOFF - 1, kept: COUNTER_CUTOFF });
    await runRateLimitsPrune(NOW);
    expect(out).toEqual(['rate-limits: pruned 2\n']);
    expect(await keysOf('rate_limits')).toEqual(['kept']);
    expect(await keysOf('request_counters')).toEqual(['kept']);
  });

  it('prunes as of the current time by default', async () => {
    vi.stubEnv('DATABASE_URL', url);
    const now = Date.now();
    await seedAuth({ old: now - BETTER_AUTH_RETENTION_MS - 60_000, kept: now });
    await runRateLimitsPrune();
    expect(out).toEqual(['rate-limits: pruned 1\n']);
    expect(await keysOf('rate_limits')).toEqual(['kept']);
  });

  it('refuses to run without a database URL', async () => {
    vi.stubEnv('DATABASE_URL', undefined);
    await expect(runRateLimitsPrune(NOW)).rejects.toThrow(/DATABASE_URL/);
    expect(out).toEqual([]);
  });
});
