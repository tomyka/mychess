import { z } from 'zod';

/** A Postgres connection URL, as every process that talks to the database takes it. */
export const databaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/ });

/**
 * The environment every process that talks only to the database needs.
 * The web app's environment extends this rather than re-declaring `DATABASE_URL`.
 */
export const databaseEnvSchema = z.object({ DATABASE_URL: databaseUrlSchema });
