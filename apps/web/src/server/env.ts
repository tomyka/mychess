import { databaseEnvSchema } from '@mychess/db';
import { z } from 'zod';

/** The secret `.env.example` ships with; no environment may run on it (A7). */
const PLACEHOLDER_SECRET = 'change-me-to-32-or-more-random-characters';

const DEPLOYED = new Set(['staging', 'production']);

interface DeployedFields {
  readonly MYCHESS_ENV: string;
  readonly BETTER_AUTH_URL: string;
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
}

/** Staging and production serve over https and offer Google (security A7). */
const deployedNeeds =
  (key: keyof DeployedFields, ok: (value: string) => boolean) =>
  (e: DeployedFields): boolean =>
    !DEPLOYED.has(e.MYCHESS_ENV) || ok(e[key]);

const isHttps = (url: string) => url.startsWith('https://');
const isSet = (value: string) => value !== '';

/** Every variable the web app reads (.env.example documents them). */
export const webEnvSchema = databaseEnvSchema
  .extend({
    MYCHESS_ENV: z.enum(['local', 'staging', 'production']).default('local'),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32)
      .refine((secret) => secret !== PLACEHOLDER_SECRET),
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
  })
  .refine(deployedNeeds('BETTER_AUTH_URL', isHttps), {
    path: ['BETTER_AUTH_URL'],
  })
  .refine(deployedNeeds('GOOGLE_CLIENT_ID', isSet), {
    path: ['GOOGLE_CLIENT_ID'],
  })
  .refine(deployedNeeds('GOOGLE_CLIENT_SECRET', isSet), {
    path: ['GOOGLE_CLIENT_SECRET'],
  });

export type WebEnv = z.infer<typeof webEnvSchema>;

/** The parsed process environment; throws at start-up when it is incomplete. */
export function readWebEnv(): WebEnv {
  return webEnvSchema.parse(process.env);
}
