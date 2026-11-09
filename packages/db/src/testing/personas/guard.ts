import { ok, refuse, type Result } from '@mychess/domain';
import { databaseUrlSchema } from '../../config';

/** Why the persona seed will not run; message keys, printed as they are. */
export const SEED_REFUSALS = {
  notLocalEnv: 'seed.notLocalEnv',
  databaseUrlInvalid: 'seed.databaseUrlInvalid',
  notLocalDatabase: 'seed.notLocalDatabase',
} as const;

/** The variables the seed reads; `process.env` is one. */
export interface SeedEnv {
  readonly MYCHESS_ENV?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
}

export interface SeedRefusal {
  readonly reason: (typeof SEED_REFUSALS)[keyof typeof SEED_REFUSALS];
}

/**
 * The hosts a local stack's database answers on: the loopback names, and
 * the developer's machine as a container sees it. A compose service name
 * such as `postgres` is not one of them: it is also production's database
 * host (infra/compose/app.yml). The host check stands on its own, as a
 * second guard beside MYCHESS_ENV.
 */
const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  'host.docker.internal',
]);

/** Query parameters with which pg connects to a host other than the URL's. */
const HOST_OVERRIDES = ['host', 'hostaddr'];

function isLocalDatabase(url: string): boolean {
  const parsed = new URL(url);
  // A postgres: URL is not a "special" URL, so its host keeps its case.
  return (
    LOCAL_HOSTS.has(parsed.hostname.toLowerCase()) &&
    HOST_OVERRIDES.every((name) => !parsed.searchParams.has(name))
  );
}

/**
 * The database the persona seed may write to (R-32, R-168): only with
 * MYCHESS_ENV exactly `local` (unset is refused: the production admin
 * container sets none), and only a database on this machine. Anything else
 * is refused before a connection is opened, so a refused run seeds nothing.
 */
export function seedTarget(env: SeedEnv): Result<string, SeedRefusal> {
  if (env.MYCHESS_ENV !== 'local') return refuse(SEED_REFUSALS.notLocalEnv);
  const url = databaseUrlSchema.safeParse(env.DATABASE_URL);
  if (!url.success) return refuse(SEED_REFUSALS.databaseUrlInvalid);
  return isLocalDatabase(url.data)
    ? ok(url.data)
    : refuse(SEED_REFUSALS.notLocalDatabase);
}
