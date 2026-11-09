// An account's stored language, read and written straight in the E2E
// database (R-180): no screen offers a language now, so a journey that
// needs an account stored in Lithuanian sets it here. Only the test's own
// fresh @mychess.test accounts are touched, found by email; every value is
// a bound parameter.
import pg from 'pg';
import { z } from 'zod';
import { requireFreshEmail, type Locale } from './journey';

/** The database the app under test uses (playwright.config.ts, same default). */
const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgres://mychess:mychess@127.0.0.1:5432/mychess';

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

/** Stores `locale` as the language of the account of `email`. */
export async function storeLocale(
  email: string,
  locale: Locale,
): Promise<void> {
  const { rowCount } = await query(
    'update accounts set locale = $2 where email = $1',
    [requireFreshEmail(email), locale],
  );
  if (rowCount !== 1) throw new Error(`storeLocale: no account ${email}`);
}

/** The stored language of the account of `email`. */
export async function storedLocale(email: string): Promise<string> {
  const { rows } = await query('select locale from accounts where email = $1', [
    requireFreshEmail(email),
  ]);
  const [row] = z.array(z.object({ locale: z.string() })).parse(rows);
  if (row === undefined) throw new Error(`storedLocale: no account ${email}`);
  return row.locale;
}
