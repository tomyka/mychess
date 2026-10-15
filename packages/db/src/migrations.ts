// A runtime entry of its own (`@mychess/db/migrations`), not part of the
// package's main entry: the web app's bundler would try to resolve
// `../migrations` below as a module, and the web app never migrates.
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

/**
 * `migrations/` beside `src/` - and beside `dist/` once this file is bundled
 * into dist/migrate.mjs, so the same relative path holds.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(
  new URL('../migrations', import.meta.url),
);

/** The Postgres image every test suite runs on, bumped deliberately. */
export const POSTGRES_IMAGE = 'postgres:18.6';

export async function runMigrations(
  url: string,
  migrationsFolder: string,
): Promise<void> {
  const { db, close } = createDb(url);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
