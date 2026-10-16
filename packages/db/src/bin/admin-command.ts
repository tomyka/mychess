import { canonicalEmail } from '@mychess/domain';
import type { AdminRefusal, grantAdmin } from '../admin';
import { createDb } from '../client';
import { databaseEnvSchema } from '../config';
import type { Result } from '@mychess/chess';

/** `grantAdmin` or `disableAccount`: one audited Admin change. */
type AdminChange = (
  ...args: Parameters<typeof grantAdmin>
) => Promise<Result<undefined, AdminRefusal>>;

/**
 * The body of the admin:grant and admin:disable scripts: canonicalises the
 * email in argv[2], runs `change` as actor `cli`, prints `admin: <done>
 * <email>` or the refusal reason on stderr with exit code 1.
 */
export async function runAdminCommand(
  command: string,
  done: string,
  change: AdminChange,
): Promise<void> {
  const env = databaseEnvSchema.parse(process.env);
  const email = canonicalEmail(process.argv[2] ?? '');
  if (!email.ok) {
    process.stderr.write(`${command}: ${email.refusal.reason}\n`);
    process.exitCode = 1;
    return;
  }
  const { db, close } = createDb(env.DATABASE_URL);
  try {
    const result = await change(db, email.value, 'cli', new Date());
    if (result.ok) {
      process.stdout.write(`admin: ${done} ${email.value}\n`);
    } else {
      process.stderr.write(`${command}: ${result.refusal.reason}\n`);
      process.exitCode = 1;
    }
  } finally {
    await close();
  }
}
