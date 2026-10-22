/** Account display names for the assignment reads. Internal to the package. */
import { z } from 'zod';
import type { Executor } from '../client';
import { accounts } from '../schema';
import { inIds } from './pairs';

const nameRowsSchema = z.array(
  z.object({ id: z.string().min(1), displayName: z.string() }),
);

/** Display names by account id, in one statement; none for no ids. */
export async function namesOf(
  db: Executor,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = nameRowsSchema.parse(
    await db
      .select({ id: accounts.id, displayName: accounts.displayName })
      .from(accounts)
      .where(inIds(accounts.id, [...new Set(ids)])),
  );
  return new Map(rows.map((row) => [row.id, row.displayName]));
}
