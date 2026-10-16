import { databaseEnvSchema } from '@mychess/db';
import { z } from 'zod';

/** Every variable the web app reads (.env.example documents them). */
export const webEnvSchema = databaseEnvSchema
  .extend({
    MYCHESS_ENV: z.enum(['local', 'staging', 'production']).default('local'),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    MAIL_TRANSPORT: z.enum(['resend', 'mailpit']),
    MAIL_FROM: z.string().min(3),
    MAILPIT_URL: z.url().optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    LICHESS_CLIENT_ID: z.string().min(1),
    MYCHESS_TEST_SIGNIN: z.stringbool().default(false),
    TEST_SIGNIN_SECRET: z.string().min(32).optional(),
  })
  .refine(
    (e) => e.MAIL_TRANSPORT !== 'resend' || e.RESEND_API_KEY !== undefined,
    {
      path: ['RESEND_API_KEY'],
    },
  )
  .refine(
    (e) => e.MAIL_TRANSPORT !== 'mailpit' || e.MAILPIT_URL !== undefined,
    {
      path: ['MAILPIT_URL'],
    },
  )
  .refine((e) => !e.MYCHESS_TEST_SIGNIN || e.TEST_SIGNIN_SECRET !== undefined, {
    path: ['TEST_SIGNIN_SECRET'],
  });

export type WebEnv = z.infer<typeof webEnvSchema>;

/** The parsed process environment; throws at start-up when it is incomplete. */
export function readWebEnv(): WebEnv {
  return webEnvSchema.parse(process.env);
}
