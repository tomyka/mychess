import { createDb, databaseEnvSchema, ping } from '@mychess/db';

// Liveness for deploy smoke tests and uptime checks: the app answers, and so
// does its database. Machine-readable status values, not user-visible text.
const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(): Promise<Response> {
  const { DATABASE_URL } = databaseEnvSchema.parse(process.env);
  const { db, close } = createDb(DATABASE_URL);
  try {
    await ping(db);
    return Response.json(
      { status: 'ok', database: 'up' },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error('health: database unreachable', error);
    return Response.json(
      { status: 'unavailable', database: 'down' },
      { status: 503, headers: NO_STORE },
    );
  } finally {
    await close();
  }
}
