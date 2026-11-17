// Time passing for the C-M1-3 journey (R-16): a group deadline that was
// ahead when set and is behind now. The app refuses setting a past day
// (R-210), so the test moves the stored day itself, straight in the E2E
// database. Only the test's own fresh @mychess.test accounts are touched,
// found by email; every value is a bound parameter.
import pg from 'pg';
import { requireFreshEmail } from './journey';

/** The database the app under test uses (playwright.config.ts, same default). */
const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgres://mychess:mychess@127.0.0.1:5432/mychess';

/**
 * Sets to `day` (`YYYY-MM-DD`) the deadline of the group assignment of the
 * coach's repertoire `repertoire` to the groups `memberEmail` is in, as if
 * that much time had passed since it was set. Throws unless exactly one
 * assignment changed.
 */
export async function passGroupDeadline(
  memberEmail: string,
  repertoire: string,
  day: string,
): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const moved = await client.query(
      `update assignments a
          set deadline = $3::date
         from repertoires r
        where r.id = a.repertoire_id
          and r.owner_account_id = a.coach_id
          and r.name = $2
          and a.group_id in (
            select m.group_id
              from group_members m
              join accounts p on p.id = m.player_id
             where p.email = $1)`,
      [requireFreshEmail(memberEmail), repertoire, day],
    );
    if (moved.rowCount !== 1)
      throw new Error(`moved ${String(moved.rowCount)} group deadlines`);
  } finally {
    await client.end();
  }
}
