import { databaseEnvSchema } from '@mychess/db';
import { z } from 'zod';

/** The secret `.env.example` ships with; no environment may run on it (A7). */
const PLACEHOLDER_SECRET = 'change-me-to-32-or-more-random-characters';

const DEPLOYED = new Set(['staging', 'production']);

const LOCAL = 'local';

interface VercelFields {
  readonly MYCHESS_ENV?: string | undefined;
  readonly VERCEL?: string | undefined;
}

/**
 * The production lock fails closed (security N1): Vercel sets `VERCEL` on
 * every deployment, and there MYCHESS_ENV has no default, so a deployment
 * that forgot it refuses to start rather than running as local.
 */
const namedOnVercel = (e: VercelFields): boolean =>
  (e.VERCEL ?? '') === '' || e.MYCHESS_ENV !== undefined;

interface DeployedFields {
  readonly BETTER_AUTH_URL: string;
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
}

/** Staging and production serve over https and offer Google (security A7). */
const deployedNeeds =
  (key: keyof DeployedFields, ok: (value: string) => boolean) =>
  (e: DeployedFields & Pick<VercelFields, 'MYCHESS_ENV'>): boolean =>
    !DEPLOYED.has(e.MYCHESS_ENV ?? LOCAL) || ok(e[key]);

const isHttps = (url: string) => url.startsWith('https://');
const isSet = (value: string) => value !== '';

/** Every variable the web app reads (.env.example documents them). */
export const webEnvSchema = databaseEnvSchema
  .extend({
    // No default here: off Vercel it falls back to local below.
    MYCHESS_ENV: z.enum([LOCAL, 'staging', 'production']).optional(),
    VERCEL: z.string().optional(),
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
  // Production refuses the persona sign-in at start-up (R-73, R-93).
  .refine((e) => !e.MYCHESS_TEST_SIGNIN || e.MYCHESS_ENV !== 'production', {
    path: ['MYCHESS_TEST_SIGNIN'],
  })
  .refine(deployedNeeds('BETTER_AUTH_URL', isHttps), {
    path: ['BETTER_AUTH_URL'],
  })
  .refine(deployedNeeds('GOOGLE_CLIENT_ID', isSet), {
    path: ['GOOGLE_CLIENT_ID'],
  })
  .refine(deployedNeeds('GOOGLE_CLIENT_SECRET', isSet), {
    path: ['GOOGLE_CLIENT_SECRET'],
  })
  .refine(namedOnVercel, { path: ['MYCHESS_ENV'] })
  .transform((e) => ({ ...e, MYCHESS_ENV: e.MYCHESS_ENV ?? LOCAL }));

export type WebEnv = z.infer<typeof webEnvSchema>;

/** Google sign-in is offered only when both its credentials are set (A7). */
export function googleConfigured(
  env: Pick<WebEnv, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>,
): boolean {
  return isSet(env.GOOGLE_CLIENT_ID) && isSet(env.GOOGLE_CLIENT_SECRET);
}

/** The parsed process environment; throws at start-up when it is incomplete. */
export function readWebEnv(): WebEnv {
  return webEnvSchema.parse(process.env);
}
