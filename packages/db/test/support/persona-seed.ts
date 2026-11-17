// What the persona seed tests share (test/persona-seed-*.test.ts, split
// by area so the files run in parallel, #366): the seed date, the time a
// seed takes, and the reads they check it with.
import { personaEmail } from '@mychess/domain';
import { z } from 'zod';
import { findAccountByEmail, listRepertoires, type Db } from '../../src';
import type { TestDatabaseConnection } from '../../src/testing';

/** The seed date every persona test seeds as of. */
export const NOW = new Date('2026-11-09T08:00:00Z');
/** Seeding replays almost a year of training through recordResults. */
export const SLOW = 240_000;

const namesSchema = z.array(z.object({ name: z.string() }));
const countsSchema = z.array(z.object({ name: z.string(), n: z.number() }));

/** Every table's row count, by table name. */
export async function tableCounts(
  client: TestDatabaseConnection['client'],
): Promise<Map<string, number>> {
  const { rows } = await client.query(
    `select tablename as name from pg_tables where schemaname = 'public' order by tablename`,
  );
  const counts = new Map<string, number>();
  for (const { name } of namesSchema.parse(rows)) {
    const result = await client.query(
      `select '${name}' as name, count(*)::int as n from "${name}"`,
    );
    for (const row of countsSchema.parse(result.rows))
      counts.set(row.name, row.n);
  }
  return counts;
}

/** The seeded account with this persona email; throws if there is none. */
export async function persona(
  db: Db,
  email: string,
): Promise<NonNullable<Awaited<ReturnType<typeof findAccountByEmail>>>> {
  const canonical = personaEmail(email);
  if (!canonical.ok) throw new Error(email);
  const found = await findAccountByEmail(db, canonical.value);
  if (found === undefined) throw new Error(`no account ${email}`);
  return found;
}

/** The id of `ownerId`'s repertoire named `name`; throws if there is none. */
export async function idOfRepertoire(
  db: Db,
  ownerId: string,
  name: string,
): Promise<string> {
  const found = (await listRepertoires(db, ownerId)).find(
    (r) => r.name === name,
  );
  if (found === undefined) throw new Error(`no repertoire ${name}`);
  return found.id;
}
