// The broadcast index's fixture months, reset straight in the E2E database
// (#316), so every run of the journey sees its months become ready rather
// than finding them indexed by the run before. The reset is the one
// docs/operations.md gives: back to pending, never a deleted row. Only the
// fixture's invented months are touched; every value is a bound parameter.
import pg from 'pg';
import { FIXTURE_MONTHS } from './broadcast-fixture';

/** The database the app under test uses (playwright.config.ts, same default). */
const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgres://mychess:mychess@127.0.0.1:5432/mychess';

/** Sets the fixture months back to pending, with no attempts used. */
export async function resetFixtureMonths(): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `update broadcast_months
          set state = 'pending', attempts = 0, failed_at = null
        where month = any($1::text[])`,
      [[...FIXTURE_MONTHS]],
    );
  } finally {
    await client.end();
  }
}
