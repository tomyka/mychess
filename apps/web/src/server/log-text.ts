/**
 * What a server log line may say of an error (security L1 of #316): the
 * broadcast index logs failures without the game data or query
 * parameters an error's own message can hold.
 */
import { z } from 'zod';

/** The most characters of a failed query's cause a log line keeps. */
const CAUSE_CHARS = 200;

/**
 * A failed Drizzle query (DrizzleQueryError): its message holds the query
 * and its parameters, so only its cause, the driver's error, is logged.
 */
const failedQuerySchema = z.object({
  query: z.string(),
  params: z.array(z.unknown()),
  cause: z.instanceof(Error),
});

/**
 * What the log says of `error` (security L1): its name, and for a failed
 * query its cause's message, capped; never an error's own message, which
 * may hold game data or query parameters.
 */
export function logText(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const query = failedQuerySchema.safeParse(error);
  if (!query.success) return error.name;
  const { cause } = query.data;
  return `${error.name}: ${cause.message.slice(0, CAUSE_CHARS)}`;
}
