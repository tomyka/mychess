import { createDb, type Db } from '@mychess/db';
import { readWebEnv } from './env';

let db: Db | undefined;

/** One pool per server process, opened on first use. */
export function getDb(): Db {
  db ??= createDb(readWebEnv().DATABASE_URL).db;
  return db;
}
