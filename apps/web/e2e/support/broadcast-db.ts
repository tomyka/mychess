// The broadcast index's fixture months and tournaments, reset straight in
// the E2E database (#316, #349), so every run of a journey sees its months
// become ready and its tournaments fetched rather than finding them indexed
// by the run before. A month is reset as docs/operations.md gives it: back
// to pending, never a deleted row. A fixture tournament is deleted, as a
// journey must see it added anew; no month's game is stored under it. Only
// the fixture's invented months and tournaments are touched; every value is
// a bound parameter.
import pg from 'pg';
import { FIXTURE_TOUR_IDS } from './broadcast-api-fixture';
import { FIXTURE_MONTHS } from './broadcast-fixture';

/** The database the app under test uses (playwright.config.ts, same default). */
const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgres://mychess:mychess@127.0.0.1:5432/mychess';

/** Sets the fixture months back to pending, with no attempts used. */
export async function resetFixtureMonths(): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `update broadcast_months
          set state = 'pending', attempts = 0, failed_at = null
        where month = any($1::text[])`,
      [[...FIXTURE_MONTHS]],
    );
  });
}

/**
 * Removes the fixture tournaments from the index, their games cascading
 * with them.
 */
export async function removeFixtureTours(): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      'delete from broadcast_tours where tour_id = any($1::text[])',
      [[...FIXTURE_TOUR_IDS]],
    );
  });
}

/** The fixture tournaments in the index, by id, with their states. */
export async function fixtureTourStates(): Promise<Record<string, string>> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ tour_id: string; state: string }>(
      'select tour_id, state from broadcast_tours where tour_id = any($1::text[])',
      [[...FIXTURE_TOUR_IDS]],
    );
    return Object.fromEntries(rows.map((row) => [row.tour_id, row.state]));
  });
}

async function withClient<T>(
  use: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}
