import { z } from 'zod';

// The commit this server was built from: the image's APP_COMMIT, which CI's
// build sets (Dockerfile). The deploy's release check and the uptime watch
// compare it with the commit they expect (infra/ci/verify-release.sh).
// Machine-readable, never cached; null where the build named no commit.
const NO_STORE = { 'cache-control': 'no-store' };
const versionEnvSchema = z.object({
  APP_COMMIT: z
    .string()
    .transform((commit) => (commit === '' ? null : commit))
    .optional(),
});

export function GET(): Response {
  const { APP_COMMIT } = versionEnvSchema.parse(process.env);
  return Response.json({ commit: APP_COMMIT ?? null }, { headers: NO_STORE });
}
