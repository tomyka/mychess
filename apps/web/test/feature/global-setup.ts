import type { TestProject } from 'vitest/node';
import { startTestDatabase } from '@mychess/db/testing';

// One migrated Postgres for the whole feature suite, as the db suite has.
export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const database = await startTestDatabase();
  project.provide('databaseUrl', database.url);
  return database.stop;
}
