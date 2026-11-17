import type { TestProject } from 'vitest/node';
import { startTestDatabase } from '../src/testing';

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const database = await startTestDatabase();
  project.provide('templateDatabaseUrl', database.url);
  return database.stop;
}
