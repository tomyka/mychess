import { databaseEnvSchema } from '@mychess/db';
import { z } from 'zod';

/** The secret `.env.example` ships with; no environment may run on it (A7). */
const PLACEHOLDER_SECRET = 'change-me-to-32-or-more-random-characters';

const LOCAL = 'local';

const PRODUCTION = 'production';

interface ProductionFields {
  readonly BETTER_AUTH_URL: string;
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
}

/** Production serves over https and offers Google (security A7). */
const productionNeeds =
  (key: keyof ProductionFields, ok: (value: string) => boolean) =>
  (
    e: ProductionFields & { readonly MYCHESS_ENV?: string | undefined },
  ): boolean =>
    e.MYCHESS_ENV !== PRODUCTION || ok(e[key]);

/**
 * The production lock fails closed (security N1): a production build
 * (`next start`, the image) has no default, so a deployment that forgot
 * MYCHESS_ENV refuses to start rather than running as local.
 */
const namedInProductionBuild = (e: {
  readonly MYCHESS_ENV?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}): boolean => e.NODE_ENV !== PRODUCTION || e.MYCHESS_ENV !== undefined;

const isHttps = (url: string) => url.startsWith('https://');
const isSet = (value: string) => value !== '';

/** Every variable the web app reads (.env.example documents them). */
export const webEnvSchema = databaseEnvSchema
  .extend({
    // There is no staging (R-166). Unset means local, but only outside a
    // production build (namedInProductionBuild below).
    MYCHESS_ENV: z.enum([LOCAL, PRODUCTION]).optional(),
    // Next.js sets it: production under `next start` and in the image.
    NODE_ENV: z.string().optional(),
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
  .refine((e) => !e.MYCHESS_TEST_SIGNIN || e.MYCHESS_ENV !== PRODUCTION, {
    path: ['MYCHESS_TEST_SIGNIN'],
  })
  .refine(productionNeeds('BETTER_AUTH_URL', isHttps), {
    path: ['BETTER_AUTH_URL'],
  })
  .refine(productionNeeds('GOOGLE_CLIENT_ID', isSet), {
    path: ['GOOGLE_CLIENT_ID'],
  })
  .refine(productionNeeds('GOOGLE_CLIENT_SECRET', isSet), {
    path: ['GOOGLE_CLIENT_SECRET'],
  })
  .refine(namedInProductionBuild, { path: ['MYCHESS_ENV'] })
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
