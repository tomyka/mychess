import type { Entitlement } from '@mychess/domain';
import type pg from 'pg';
import { z } from 'zod';
import type { Db } from '../../src';
import { accounts, coachLinks, groupMembers, groups } from '../../src/schema';

export const T0 = new Date('2026-10-16T08:00:00Z');

const onboarded = (id: string, email: string) => ({
  id,
  email,
  emailVerified: true,
  displayName: `Name ${id}`,
  onboardedAt: T0,
  createdAt: T0,
  updatedAt: T0,
});

/** An onboarded account with Coach mode on since T0. */
export async function seedCoach(
  db: Db,
  id: string,
  email: string,
  entitlement: Entitlement = 'free',
): Promise<void> {
  await db
    .insert(accounts)
    .values({ ...onboarded(id, email), entitlement, coachSince: T0 });
}

/** An onboarded account with Coach mode off. */
export async function seedPlayer(
  db: Db,
  id: string,
  email: string,
): Promise<void> {
  await db.insert(accounts).values(onboarded(id, email));
}

/**
 * Names out of Lithuanian order, and that order (R-160): y sorts with i,
 * before j, and Ž after Z. Neither the C nor an English collation gives it.
 */
export const UNSORTED_NAMES = ['Jonas', 'Yra', 'Ieva', 'Žalias', 'Zuikis'];
export const LITHUANIAN_ORDER = ['Ieva', 'Yra', 'Jonas', 'Zuikis', 'Žalias'];

/**
 * One onboarded account per name, ids `<prefix>-1` .. in the names' order,
 * in Coach mode since T0 when `coach`; returns their ids.
 */
export async function seedNamedAccounts(
  db: Db,
  prefix: string,
  names: readonly string[],
  { coach = false }: { readonly coach?: boolean } = {},
): Promise<string[]> {
  const rows = names.map((displayName, i) => {
    const id = `${prefix}-${String(i + 1)}`;
    return {
      ...onboarded(id, `${id}@example.lt`),
      displayName,
      coachSince: coach ? T0 : null,
    };
  });
  await db.insert(accounts).values(rows);
  return rows.map((row) => row.id);
}

/** Links `coachId` to an existing player at T0. */
export async function seedLink(
  db: Db,
  coachId: string,
  playerId: string,
): Promise<void> {
  await db.insert(coachLinks).values({ coachId, playerId, createdAt: T0 });
}

/**
 * `count` new players `<coachId>-p-1` .. `<coachId>-p-<count>`, each linked
 * to `coachId` (the setups at a player limit).
 */
export async function seedLinks(
  db: Db,
  coachId: string,
  count: number,
): Promise<void> {
  const ids = Array.from({ length: count }, (_, i) =>
    [coachId, 'p', String(i + 1)].join('-'),
  );
  if (ids.length === 0) return;
  await db
    .insert(accounts)
    .values(ids.map((id) => onboarded(id, `${id}@example.lt`)));
  await db
    .insert(coachLinks)
    .values(ids.map((playerId) => ({ coachId, playerId, createdAt: T0 })));
}

/** A group of `coachId` made at T0; returns its id. */
export async function seedGroup(
  db: Db,
  coachId: string,
  name: string,
): Promise<string> {
  const [row] = await db
    .insert(groups)
    .values({ coachId, name, createdAt: T0 })
    .returning({ id: groups.id });
  if (row === undefined) throw new Error('seedGroup: no row');
  return row.id;
}

/** Puts a linked player into a group of `coachId` at T0. */
export async function seedMember(
  db: Db,
  coachId: string,
  groupId: string,
  playerId: string,
): Promise<void> {
  await db
    .insert(groupMembers)
    .values({ groupId, coachId, playerId, joinedAt: T0 });
}

/**
 * Runs `statements` in a transaction left open on its own connection, so a
 * test can hold row locks while the code under test runs. `finish` commits
 * the transaction (with `then` run first, inside it) and frees the connection.
 */
export async function openTransaction(
  pool: pg.Pool,
  statements: readonly string[],
): Promise<{ finish: (then?: string) => Promise<void> }> {
  const connection = await pool.connect();
  await connection.query('begin');
  for (const statement of statements) await connection.query(statement);
  return {
    finish: async (then) => {
      try {
        if (then !== undefined) await connection.query(then);
        await connection.query('commit');
      } finally {
        connection.release();
      }
    },
  };
}

const waitingSchema = z.array(z.object({ n: z.number() }));

/** Resolves once `count` sessions of this database (one by default) wait for a row lock. */
export async function someoneWaitsForALock(
  pool: pg.Pool,
  count = 1,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { rows } = await pool.query(
      `select count(*)::int as n from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((waitingSchema.parse(rows)[0]?.n ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('nobody waited for a lock');
}
