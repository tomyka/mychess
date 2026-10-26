// The training history the S6 journeys start from, written straight into
// the E2E database (plan Task D3): Reviews already due, so a journey needs
// no clock moved, and the reads that check what the server recorded. Only
// the test's own fresh @mychess.test accounts are touched; every statement
// finds the account by that email.
import { createDb, type DbHandle } from '@mychess/db';
import { z } from 'zod';

/** The database the app under test uses (playwright.config.ts, same default). */
const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgres://mychess:mychess@127.0.0.1:5432/mychess';

/** A SQL string literal: the values here are emails and move keys. */
const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** The account of `email`, as a subquery. */
const accountOf = (email: string): string =>
  `(select id from accounts where email = ${literal(email)})`;

async function withDb<T>(use: (handle: DbHandle) => Promise<T>): Promise<T> {
  const handle = createDb(DATABASE_URL);
  try {
    return await use(handle);
  } finally {
    await handle.close();
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
  const rows = keys.map(
    (key, i) =>
      `(${accountOf(email)}, ${literal(key)}, now() - interval '${String(keys.length - i)} minutes')`,
  );
  await withDb(({ db: database }) =>
    database.execute(
      `insert into reviews (player_id, move_key, due, stability, difficulty,
         elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
         last_review, learned_at, created_at, updated_at)
       select v.player_id, v.move_key, v.due, 4, 5, 3, 3, 0, 2, 0, 2,
         now() - interval '3 days', now() - interval '4 days',
         now() - interval '4 days', now() - interval '4 days'
       from (values ${rows.join(', ')}) as v(player_id, move_key, due)
       on conflict (player_id, move_key) do update set due = excluded.due`,
    ),
  );
}

/** Makes every Review of the player of `email` due now (the next day came). */
export async function allDue(email: string): Promise<void> {
  await withDb(({ db: database }) =>
    database.execute(
      `update reviews set due = now() - interval '1 minute'
       where player_id = ${accountOf(email)}`,
    ),
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
  const result = await withDb(({ db: database }) =>
    database.execute(
      `select move_key, kind, applied from review_results
       where player_id = ${accountOf(email)} order by answered_at`,
    ),
  );
  return z.array(resultRowSchema).parse(result.rows);
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
  const result = await withDb(({ db: database }) =>
    database.execute(
      `select move_key, due, learned_at, skipped_at from reviews
       where player_id = ${accountOf(email)}`,
    ),
  );
  return z.array(reviewRowSchema).parse(result.rows);
}
