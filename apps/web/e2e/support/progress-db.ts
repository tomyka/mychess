// A known Review history for the C-M1-5 journey (S7 plan Task E1), written
// straight into the E2E database, so the coach's progress pages can be
// checked against exactly what was seeded. Only the test's own fresh
// @mychess.test accounts are touched; every statement finds the account by
// that email. Every value is a bound parameter ($1..); the only SQL chosen
// in code is a fixed fragment per state, never input.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

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

/** A seeded move's state as the coach should see it (R-151). */
export type SeedState = 'learned' | 'due' | 'skipped';

/**
 * Each state's card, as fixed SQL: when it is due, when it was last
 * reviewed, how many reps, and how it entered training (exactly one of
 * learned_at and skipped_at, the `reviews_entered_once` check).
 * - learned: a learn pass 8 days ago, reviewed yesterday, due in a week;
 * - due: learned the same way, but due an hour ago;
 * - skipped: "I know this" today, never graded (reps 1), due tomorrow.
 */
const CARDS: Readonly<
  Record<
    SeedState,
    {
      readonly due: string;
      readonly lastReview: string;
      readonly reps: number;
      readonly learnedAt: string;
      readonly skippedAt: string;
    }
  >
> = {
  learned: {
    due: "now() + interval '7 days'",
    lastReview: "now() - interval '1 day'",
    reps: 2,
    learnedAt: "now() - interval '8 days'",
    skippedAt: 'null',
  },
  due: {
    due: "now() - interval '1 hour'",
    lastReview: "now() - interval '8 days'",
    reps: 2,
    learnedAt: "now() - interval '9 days'",
    skippedAt: 'null',
  },
  skipped: {
    due: "now() + interval '1 day'",
    lastReview: 'now()',
    reps: 1,
    learnedAt: 'null',
    skippedAt: 'now()',
  },
};

/** Writes one Review per key in `state` for the player of `email`. */
async function seedState(
  email: string,
  state: SeedState,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const card = CARDS[state];
  const { rowCount } = await query(
    `insert into reviews (player_id, move_key, due, stability, difficulty,
       elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
       last_review, learned_at, skipped_at, created_at, updated_at)
     select a.id, k, ${card.due}, 8, 5, 1, 7, 0, $3, 0, 2,
       ${card.lastReview}, ${card.learnedAt}, ${card.skippedAt},
       now() - interval '9 days', now()
     from accounts a, unnest($2::text[]) as k
     where a.email = $1`,
    [email, keys, card.reps],
  );
  if (rowCount !== keys.length)
    throw new Error(
      `seedState(${state}): wrote ${String(rowCount)} of ${String(keys.length)} Reviews`,
    );
}

/**
 * One training result of the player of `email`, a minute ago, on
 * `repertoireId` (which need not be one the coach may see: R-154 counts
 * only those that are). `review_results` keys a result by (player,
 * result id), so each call has a fresh id.
 */
export async function seedResult(
  email: string,
  repertoireId: string,
  moveKey: string,
): Promise<void> {
  const { rowCount } = await query(
    `insert into review_results (result_id, player_id, move_key,
       repertoire_id, kind, answered_at, applied, received_at)
     select $2::uuid, a.id, $3, $4::uuid, $5,
       now() - interval '1 minute', true, now() - interval '1 minute'
     from accounts a where a.email = $1`,
    [email, randomUUID(), moveKey, repertoireId, 'pass'],
  );
  if (rowCount !== 1) throw new Error(`seedResult: no account ${email}`);
}

/**
 * Writes a Review of each key for the player of `email` in the state it is
 * listed under, and, when any key is listed, one result on `repertoireId`
 * so "last trained" reads today.
 */
export async function seedHistory(
  email: string,
  repertoireId: string,
  keys: Readonly<Partial<Record<SeedState, readonly string[]>>>,
): Promise<void> {
  const states: readonly SeedState[] = ['learned', 'due', 'skipped'];
  for (const state of states) await seedState(email, state, keys[state] ?? []);
  const first = states.flatMap((state) => keys[state] ?? [])[0];
  if (first !== undefined) await seedResult(email, repertoireId, first);
}
