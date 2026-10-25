// Column and constraint helpers shared by the schema files (schema.ts,
// assignment-schema.ts, training-schema.ts).
import { sql, type SQL } from 'drizzle-orm';
import {
  timestamp,
  type PgColumn,
  type PgTimestampBuilderInitial,
} from 'drizzle-orm/pg-core';

/** A UTC timestamp column (CLAUDE.md: times are stored in UTC). */
export const at = (name: string): PgTimestampBuilderInitial<string> =>
  timestamp(name, { withTimezone: true });

/**
 * `column in ('a', 'b')` with the values inlined, for a CHECK constraint
 * built from the same list as the column's enum, so the two cannot drift.
 * The values are our own constants, never input.
 */
export const oneOf = (column: PgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;

/** `column between min and max` with the bounds inlined, for a CHECK constraint. */
export const between = (column: PgColumn, min: number, max: number): SQL =>
  sql`${column} between ${sql.raw(String(min))} and ${sql.raw(String(max))}`;
