// The training history the S6 journeys start from, written straight into
// the E2E database (plan Task D3): Reviews already due, so a journey needs
// no clock moved, and the reads that check what the server recorded. Only
// the test's own fresh @mychess.test accounts are touched; every statement
// finds the account by that email. Every value is a bound parameter ($1..),
// never spliced into the SQL text.
import pg from 'pg';
import { z } from 'zod';

/** The database the app under test uses (playwright.config.ts, same default). */
const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgres://mychess:mychess@127.0.0.1:5432/mychess';

/** Runs one statement with its values bound, on a connection of its own. */
async function query(
  text: string,
  values: readonly unknown[],
): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await client.query(text, [...values]);
  } finally {
    await client.end();
  }
}

/**
 * Gives the player of `email` a Review of each of `keys`, learned days
 * ago and due now: the first key most overdue, each next one a minute
 * later (all within the last day). A key that already has a Review keeps
 * its history and only comes due.
 */
export async function seedDue(
  email: string,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const { rowCount } = await query(
    `insert into reviews (player_id, move_key, due, stability, difficulty,
       elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
       last_review, learned_at, created_at, updated_at)
     select a.id, k.move_key,
       now() - (cardinality($2::text[]) - k.ord + 1) * interval '1 minute',
       4, 5, 3, 3, 0, 2, 0, 2,
       now() - interval '3 days', now() - interval '4 days',
       now() - interval '4 days', now() - interval '4 days'
     from accounts a, unnest($2::text[]) with ordinality as k(move_key, ord)
     where a.email = $1
     on conflict (player_id, move_key) do update set due = excluded.due`,
    [email, keys],
  );
  if (rowCount !== keys.length)
    throw new Error(
      `seedDue: wrote ${String(rowCount)} of ${String(keys.length)} Reviews`,
    );
}

/** Makes every Review of the player of `email` due now (the next day came). */
export async function allDue(email: string): Promise<void> {
  await query(
    `update reviews set due = now() - interval '1 minute'
     where player_id = (select id from accounts where email = $1)`,
    [email],
  );
}

const resultRowSchema = z.object({
  move_key: z.string(),
  kind: z.string(),
  applied: z.boolean(),
});

/** One result the server logged for the player. */
type LoggedResult = z.infer<typeof resultRowSchema>;

/** Every result the server logged for the player of `email`, oldest first. */
export async function loggedResults(email: string): Promise<LoggedResult[]> {
  const { rows } = await query(
    `select move_key, kind, applied from review_results
     where player_id = (select id from accounts where email = $1)
     order by answered_at`,
    [email],
  );
  return z.array(resultRowSchema).parse(rows);
}

const reviewRowSchema = z.object({
  move_key: z.string(),
  due: z.coerce.date(),
  learned_at: z.coerce.date().nullable(),
  skipped_at: z.coerce.date().nullable(),
});

/** One stored Review of the player. */
type StoredReviewRow = z.infer<typeof reviewRowSchema>;

/** The player's Reviews, as stored. */
export async function storedReviews(email: string): Promise<StoredReviewRow[]> {
  const { rows } = await query(
    `select move_key, due, learned_at, skipped_at from reviews
     where player_id = (select id from accounts where email = $1)`,
    [email],
  );
  return z.array(reviewRowSchema).parse(rows);
}
