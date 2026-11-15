/**
 * The processing state a broadcast month and a broadcast tournament share
 * (#316, #349): the exclusive claim, the held-claim check, the failure and
 * the release of entries a restart interrupted. The domain decides every
 * change (decideBroadcastClaim, isBroadcastClaimHeld, decideBroadcastFinish,
 * decideBroadcastFailure, isBroadcastMonthInterrupted,
 * decideBroadcastInterrupted); each table supplies its rows through an
 * IndexStateStore.
 */
import {
  decideBroadcastClaim,
  decideBroadcastFailure,
  decideBroadcastFinish,
  decideBroadcastInterrupted,
  isBroadcastClaimHeld,
  isBroadcastMonthInterrupted,
  ok,
  refuse,
  type BroadcastMonthStatus,
  type Result,
} from '@mychess/domain';
import { z } from 'zod';
import type { Executor, Tx } from './client';

/** The state columns both tables store, as an update sets them. */
interface IndexStateColumns {
  state: BroadcastMonthStatus['state'];
  attempts: number;
  claimedAt?: Date;
  failedAt?: Date | null;
  processedAt?: Date;
  gameCount?: number;
}

/** A process's hold on an entry: its key and its claim time. */
export interface IndexClaim<K> {
  readonly key: K;
  readonly claimedAt: Date;
}

/** What parses a stored key, such as broadcastMonthSchema. */
interface KeySchema<K> {
  parse(input: unknown): K;
}

/**
 * How one table's entries are read and written. `lock` selects the row of
 * `key` for update (skipping a locked row when asked), `lockProcessing` the
 * processing rows not locked; both give the columns of indexRowSchema.
 */
export interface IndexStateStore<K extends string, R extends string> {
  readonly keySchema: KeySchema<K>;
  readonly refusals: { readonly claimLost: R; readonly notClaimable: R };
  lock(tx: Tx, key: K, skipLocked: boolean): Promise<unknown[]>;
  lockProcessing(tx: Tx): Promise<unknown[]>;
  set(tx: Tx, key: K, columns: IndexStateColumns): Promise<void>;
}

const rowBase = {
  key: z.string(),
  attempts: z.number().int().nonnegative(),
};

/** An entry row by its state, with the time that state keeps (the checks). */
const indexRowsSchema = z.array(
  z.discriminatedUnion('state', [
    z.object({
      ...rowBase,
      state: z.literal('pending'),
      failedAt: z.date().nullable(),
    }),
    z.object({
      ...rowBase,
      state: z.literal('processing'),
      claimedAt: z.date(),
      failedAt: z.date().nullable(),
    }),
    z.object({
      ...rowBase,
      state: z.literal('done'),
      processedAt: z.date(),
    }),
    z.object({
      ...rowBase,
      state: z.literal('failed'),
      failedAt: z.date(),
    }),
  ]),
);
type IndexRow = z.infer<typeof indexRowsSchema>[number];

/** Parses entry rows as their keys and statuses. */
export function parseIndexRows<K extends string>(
  keySchema: KeySchema<K>,
  rows: unknown[],
): { key: K; status: BroadcastMonthStatus; failedAt: Date | null }[] {
  return indexRowsSchema.parse(rows).map((row) => ({
    key: keySchema.parse(row.key),
    status: toStatus(row),
    failedAt: 'failedAt' in row ? row.failedAt : null,
  }));
}

/** A stored row as the domain's status. */
function toStatus(row: IndexRow): BroadcastMonthStatus {
  const { attempts } = row;
  switch (row.state) {
    case 'pending':
      return { state: row.state, attempts, lastFailedAt: row.failedAt };
    case 'processing':
      return { state: row.state, attempts, since: row.claimedAt };
    case 'done':
      return { state: row.state, attempts, since: row.processedAt };
    case 'failed':
      return { state: row.state, attempts, since: row.failedAt };
  }
}

/**
 * The columns that store `status`, the inverse of toStatus: its state, its
 * attempts and the one time its state keeps (for a pending entry, its last
 * failure). The other times stay as they were.
 */
function statusColumns(status: BroadcastMonthStatus): IndexStateColumns {
  const { state, attempts } = status;
  switch (status.state) {
    case 'pending':
      return { state, attempts, failedAt: status.lastFailedAt };
    case 'processing':
      return { state, attempts, claimedAt: status.since };
    case 'done':
      return { state, attempts, processedAt: status.since };
    case 'failed':
      return { state, attempts, failedAt: status.since };
  }
}

/**
 * Claims the entry `key` at `now` inside `tx` (#316 spec decision 3). The
 * row lock decides between concurrent claims: one that finds the row
 * locked, missing, or not to be processed (decideBroadcastClaim) is refused.
 */
export async function claimIndexEntry<K extends string, R extends string>(
  tx: Tx,
  store: IndexStateStore<K, R>,
  key: K,
  now: Date,
): Promise<Result<IndexClaim<K>, { readonly reason: R }>> {
  const [row] = parseIndexRows(
    store.keySchema,
    await store.lock(tx, key, true),
  );
  const claimed =
    row === undefined ? undefined : decideBroadcastClaim(row.status, now);
  if (!claimed?.ok) {
    return refuse(store.refusals.notClaimable);
  }
  await store.set(tx, key, statusColumns(claimed.value));
  return ok({ key, claimedAt: now });
}

/**
 * The claimed entry's status, locked until the transaction ends, while
 * `claim` still holds it (isBroadcastClaimHeld); refused once it does not.
 */
export async function heldIndexStatus<K extends string, R extends string>(
  tx: Tx,
  store: IndexStateStore<K, R>,
  claim: IndexClaim<K>,
): Promise<Result<BroadcastMonthStatus, { readonly reason: R }>> {
  const [row] = parseIndexRows(
    store.keySchema,
    await store.lock(tx, claim.key, false),
  );
  return row !== undefined && isBroadcastClaimHeld(row.status, claim.claimedAt)
    ? ok(row.status)
    : refuse(store.refusals.claimLost);
}

/** Marks the held entry done at `at` with `gameCount` games. */
export async function finishIndexEntry<K extends string, R extends string>(
  tx: Tx,
  store: IndexStateStore<K, R>,
  {
    key,
    held,
    at,
    gameCount,
  }: {
    key: K;
    held: BroadcastMonthStatus;
    at: Date;
    gameCount: number;
  },
): Promise<void> {
  const done = decideBroadcastFinish(held, at);
  await store.set(tx, key, { ...statusColumns(done), gameCount });
}

/**
 * Records at `now` that the claimed entry's processing failed: pending
 * again, or failed after its last attempt (decideBroadcastFailure). Refused
 * when the claim is no longer held.
 */
export async function failIndexEntry<K extends string, R extends string>(
  db: Executor,
  store: IndexStateStore<K, R>,
  claim: IndexClaim<K>,
  now: Date,
): Promise<Result<BroadcastMonthStatus, { readonly reason: R }>> {
  return db.transaction(async (tx) => {
    const held = await heldIndexStatus(tx, store, claim);
    if (!held.ok) return held;
    const next = decideBroadcastFailure(held.value, now);
    await store.set(tx, claim.key, statusColumns(next));
    return ok(next);
  });
}

/**
 * Makes the entries a process before this one left processing pending
 * again without spending their attempt (#355, decideBroadcastInterrupted),
 * once, when this process starts at `processStartedAt` and before it claims
 * any: a restart is not a failed attempt. An entry whose write still holds
 * its row lock is left to that write. Returns how many it released.
 */
export async function releaseInterruptedEntries<
  K extends string,
  R extends string,
>(
  db: Executor,
  store: IndexStateStore<K, R>,
  processStartedAt: Date,
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = parseIndexRows(
      store.keySchema,
      await store.lockProcessing(tx),
    );
    let released = 0;
    for (const { key, status, failedAt } of rows) {
      if (!isBroadcastMonthInterrupted(status, processStartedAt)) continue;
      const pending = decideBroadcastInterrupted(status, failedAt);
      await store.set(tx, key, statusColumns(pending));
      released += 1;
    }
    return released;
  });
}
