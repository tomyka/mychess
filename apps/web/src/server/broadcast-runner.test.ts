import type { BroadcastMonthClaim, BroadcastMonthWrite } from '@mychess/db';
import {
  broadcastMonthSchema,
  ok,
  refuse,
  type BroadcastMonth,
} from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compressedDump,
  dumpResponse,
  dumpServer,
  RUTA_FIDE_ID,
  rutaMonth,
  stalledResponse,
} from '../../test/fixtures/broadcast-dumps';
import {
  createBroadcastRunner,
  RUNNER_LIMITS,
  type BroadcastIndex,
} from './broadcast-runner';

const NOW = new Date('2026-11-10T10:00:00Z');
const OCT = broadcastMonthSchema.parse('2026-10');
const SEP = broadcastMonthSchema.parse('2026-09');

/** The index the runner writes to, its every call recorded. */
const db = {
  claim: vi.fn<BroadcastIndex['claim']>(),
  write: vi.fn<BroadcastIndex['write']>(),
  fail: vi.fn<BroadcastIndex['fail']>(),
  release: vi.fn<BroadcastIndex['release']>(),
};

const claimOf = (month: BroadcastMonth): BroadcastMonthClaim => ({
  month,
  claimedAt: NOW,
});

/** A write that reads every game, as the db's does, and keeps them. */
const written: { month: string; games: unknown[] }[] = [];
let writing = 0;
let mostWriting = 0;
async function readingWrite({
  claim,
  games,
}: BroadcastMonthWrite): ReturnType<BroadcastIndex['write']> {
  writing += 1;
  mostWriting = Math.max(mostWriting, writing);
  try {
    const all: unknown[] = [];
    for await (const game of games) all.push(game);
    written.push({ month: claim.month, games: all });
    return ok({ gameCount: all.length, skipped: 0 });
  } finally {
    writing -= 1;
  }
}

const dumpOf = (month: string) => () =>
  dumpResponse(compressedDump(rutaMonth(month))).response;

function runner(
  dumps: Parameters<typeof dumpServer>[0],
  limits = RUNNER_LIMITS,
) {
  const server = dumpServer(dumps);
  const run = createBroadcastRunner({
    index: db,
    fetch: server.fetch,
    clock: () => NOW,
    limits,
  });
  return { run, server };
}

const errors = vi.spyOn(console, 'error');

beforeEach(() => {
  written.length = 0;
  writing = 0;
  mostWriting = 0;
  errors.mockReset().mockImplementation(() => undefined);
  db.claim
    .mockReset()
    .mockImplementation((month) => Promise.resolve(ok(claimOf(month))));
  db.write.mockReset().mockImplementation(readingWrite);
  db.fail
    .mockReset()
    .mockResolvedValue(ok({ state: 'failed', attempts: 3, since: NOW }));
  db.release.mockReset().mockResolvedValue(0);
});

describe('the broadcast month runner', () => {
  it('claims a needed month, streams its dump into the write and marks nothing failed', async () => {
    const { run, server } = runner({ [OCT]: dumpOf(OCT) });
    run.need([OCT]);
    await run.settled();
    expect(db.claim).toHaveBeenCalledExactlyOnceWith(OCT, NOW);
    expect(server.fetched).toEqual([
      'https://database.lichess.org/broadcast/lichess_db_broadcast_2026-10.pgn.zst',
    ]);
    expect(written).toEqual([
      {
        month: OCT,
        games: [
          expect.objectContaining({ whiteFideId: RUTA_FIDE_ID, result: '1-0' }),
          expect.objectContaining({ blackFideId: RUTA_FIDE_ID }),
        ],
      },
    ]);
    expect(db.write.mock.lastCall?.[0].claim).toEqual(claimOf(OCT));
    expect(db.write.mock.lastCall?.[0].clock()).toEqual(NOW);
    expect(db.fail).not.toHaveBeenCalled();
  });

  it('releases the months a previous process left processing once, before its first claim (#355)', async () => {
    const order: string[] = [];
    db.release.mockImplementation(() => {
      order.push('release');
      return Promise.resolve(1);
    });
    db.claim.mockImplementation((month) => {
      order.push(`claim ${month}`);
      return Promise.resolve(ok(claimOf(month)));
    });
    const { run } = runner({ [OCT]: dumpOf(OCT), [SEP]: dumpOf(SEP) });
    run.need([OCT]);
    run.need([SEP]);
    await run.settled();
    run.need([OCT]);
    await run.settled();
    expect(db.release).toHaveBeenCalledExactlyOnceWith(NOW);
    expect(order).toEqual([
      'release',
      'claim 2026-10',
      'claim 2026-09',
      'claim 2026-10',
    ]);
  });

  it('releases what was claimed before the runner was created, not before the first need', async () => {
    let now = NOW;
    const run = createBroadcastRunner({
      index: db,
      fetch: dumpServer({ [OCT]: dumpOf(OCT) }).fetch,
      clock: () => now,
    });
    now = new Date(NOW.getTime() + 60_000);
    run.need([OCT]);
    await run.settled();
    expect(db.release).toHaveBeenCalledExactlyOnceWith(NOW);
  });

  it('releases nothing until a month is needed', async () => {
    const { run } = runner({});
    run.need([]);
    await run.settled();
    expect(db.release).not.toHaveBeenCalled();
  });

  it('logs a failed release by its error name alone and still claims (#355)', async () => {
    db.release.mockRejectedValue(
      new TypeError('a text that may name anything'),
    );
    const { run } = runner({ [OCT]: dumpOf(OCT) });
    run.need([OCT]);
    await run.settled();
    run.need([SEP]);
    await run.settled();
    expect(db.release).toHaveBeenCalledOnce();
    expect(errors.mock.calls[0]).toEqual([
      'broadcast index: release failed',
      'TypeError',
    ]);
    expect(written.map((w) => w.month)).toEqual([OCT]);
    expect(db.claim).toHaveBeenCalledTimes(2);
  });

  it('downloads nothing for a month whose claim is refused: someone else has it', async () => {
    db.claim.mockResolvedValue(refuse('fide.monthNotClaimable'));
    const { run, server } = runner({ [OCT]: dumpOf(OCT) });
    run.need([OCT]);
    await run.settled();
    expect(server.fetched).toEqual([]);
    expect(db.write).not.toHaveBeenCalled();
    expect(db.fail).not.toHaveBeenCalled();
  });

  it('marks the attempt failed when the dump cannot be downloaded', async () => {
    const { run } = runner({
      [OCT]: () => new Response('gone', { status: 404 }),
    });
    run.need([OCT]);
    await run.settled();
    expect(db.write).not.toHaveBeenCalled();
    expect(db.fail).toHaveBeenCalledExactlyOnceWith(claimOf(OCT), NOW);
    expect(errors).toHaveBeenCalledOnce();
    expect(String(errors.mock.lastCall)).toContain('2026-10');
  });

  it('marks the attempt failed when the write fails, after closing the dump', async () => {
    const dump = dumpResponse(compressedDump(rutaMonth(OCT)));
    db.write.mockRejectedValue(new Error('insert failed'));
    const { run } = runner({ [OCT]: () => dump.response });
    run.need([OCT]);
    await run.settled();
    expect(db.fail).toHaveBeenCalledExactlyOnceWith(claimOf(OCT), NOW);
    expect(dump.cancelled()).toBe(true);
  });

  it('closes the dump unread and marks nothing failed when the claim was lost', async () => {
    const dump = dumpResponse(compressedDump(rutaMonth(OCT)));
    db.write.mockResolvedValue(refuse('fide.monthClaimLost'));
    const { run } = runner({ [OCT]: () => dump.response });
    run.need([OCT]);
    await run.settled();
    expect(dump.cancelled()).toBe(true);
    expect(db.fail).not.toHaveBeenCalled();
  });

  it('gives up on a download that sends no bytes for the idle limit', async () => {
    const dump = stalledResponse(compressedDump(rutaMonth(OCT)).slice(0, 8));
    const { run } = runner(
      { [OCT]: () => dump.response },
      { deadlineMs: 60_000, idleMs: 50 },
    );
    run.need([OCT]);
    await run.settled();
    expect(db.fail).toHaveBeenCalledExactlyOnceWith(claimOf(OCT), NOW);
    expect(dump.cancelled()).toBe(true);
    expect(written).toEqual([]);
  });

  it('gives up on a download that does not even answer within the idle limit', async () => {
    const { run } = runner(
      { [OCT]: 'hang' },
      { deadlineMs: 60_000, idleMs: 50 },
    );
    run.need([OCT]);
    await run.settled();
    expect(db.write).not.toHaveBeenCalled();
    expect(db.fail).toHaveBeenCalledExactlyOnceWith(claimOf(OCT), NOW);
  });

  it('gives up on a download still running at the deadline, however it trickles', async () => {
    const dump = stalledResponse(compressedDump(rutaMonth(OCT)).slice(0, 8), 5);
    const { run } = runner(
      { [OCT]: () => dump.response },
      { deadlineMs: 100, idleMs: 60_000 },
    );
    run.need([OCT]);
    await run.settled();
    expect(db.fail).toHaveBeenCalledExactlyOnceWith(claimOf(OCT), NOW);
    expect(dump.cancelled()).toBe(true);
  });

  it('processes one month at a time, each once, in the order needed', async () => {
    const { run, server } = runner({ [OCT]: dumpOf(OCT), [SEP]: dumpOf(SEP) });
    run.need([OCT, SEP]);
    run.need([SEP, OCT]);
    await run.settled();
    expect(server.fetched.map((url) => url.slice(-15, -8))).toEqual([
      '2026-10',
      '2026-09',
    ]);
    expect(written.map((w) => w.month)).toEqual([OCT, SEP]);
    expect(mostWriting).toBe(1);
  });

  it('keeps going after a month whose failure could not be recorded', async () => {
    db.fail.mockRejectedValue(new Error('db down'));
    const { run } = runner({
      [OCT]: () => new Response('', { status: 500 }),
      [SEP]: dumpOf(SEP),
    });
    run.need([OCT, SEP]);
    await run.settled();
    expect(written.map((w) => w.month)).toEqual([SEP]);
  });

  it('starts again for a month needed after it went idle', async () => {
    const { run } = runner({ [OCT]: dumpOf(OCT), [SEP]: dumpOf(SEP) });
    run.need([OCT]);
    await run.settled();
    run.need([]);
    await run.settled();
    run.need([SEP]);
    await run.settled();
    expect(written.map((w) => w.month)).toEqual([OCT, SEP]);
  });

  it('finishes a write that holds each game longer than the idle limit (arch M2)', async () => {
    const games = [...rutaMonth(OCT), ...rutaMonth(SEP)].slice(0, 3);
    db.write.mockImplementation(async ({ games: stream }) => {
      let count = 0;
      for await (const game of stream) {
        expect(game).toBeDefined();
        count += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return ok({ gameCount: count, skipped: 0 });
    });
    const { run } = runner(
      { [OCT]: () => dumpResponse(compressedDump(games), 16).response },
      { deadlineMs: 60_000, idleMs: 50 },
    );
    run.need([OCT]);
    await run.settled();
    expect(await db.write.mock.results[0]?.value).toEqual(
      ok({ gameCount: 3, skipped: 0 }),
    );
    expect(db.fail).not.toHaveBeenCalled();
  });

  it('logs a failed query by its cause, never its text or parameters (security L1)', async () => {
    const cause = new Error(`connection terminated ${'x'.repeat(300)}`);
    const failed = Object.assign(
      new Error('Failed query: insert ...\nparams: 90000001,Pavyzdyte, Ruta'),
      { query: 'insert ...', params: [90_000_001, 'Pavyzdyte, Ruta'], cause },
    );
    db.write.mockRejectedValue(failed);
    const { run } = runner({ [OCT]: dumpOf(OCT) });
    run.need([OCT]);
    await run.settled();
    const line = (errors.mock.lastCall ?? []).join(' ');
    expect(line).toContain('2026-10');
    expect(line).toContain('Error: connection terminated xxx');
    expect(line).not.toContain('90000001');
    expect(line).not.toContain('Failed query');
    expect(line).not.toContain('x'.repeat(201));
  });

  it('logs any other error by its name alone', async () => {
    db.write.mockRejectedValue(new TypeError('a text that may name anything'));
    const { run } = runner({ [OCT]: dumpOf(OCT) });
    run.need([OCT]);
    await run.settled();
    expect(errors.mock.lastCall).toEqual([
      'fide: broadcast month 2026-10 failed',
      'TypeError',
    ]);
  });

  it('has the limits of the security requirements', () => {
    expect(RUNNER_LIMITS).toEqual({ deadlineMs: 10 * 60_000, idleMs: 60_000 });
  });
});
