import { userInfo } from 'node:os';
import { canonicalEmail, type AdminRefusal } from '@mychess/domain';
import type { grantAdmin } from '../admin';
import { createDb } from '../client';
import { databaseEnvSchema } from '../config';
import type { Result } from '@mychess/chess';

/** `grantAdmin` or `disableAccount`: one audited Admin change. */
type AdminChange = (
  ...args: Parameters<typeof grantAdmin>
) => Promise<Result<undefined, AdminRefusal>>;

/**
 * Who ran an admin command, for the audit row: `cli:<OS user name>`, or
 * `cli:unknown` when the OS cannot name the user (`userInfo` throws on an
 * account without a passwd entry).
 */
export function cliActor(
  osUser: () => { readonly username: string } = userInfo,
): string {
  try {
    const { username } = osUser();
    return `cli:${username === '' ? 'unknown' : username}`;
  } catch {
    return 'cli:unknown';
  }
}

/**
 * The body of the admin:grant and admin:disable scripts: canonicalises the
 * email in argv[2], runs `change` as the `cliActor`, prints `admin: <done>
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
    const result = await change(db, email.value, cliActor(), new Date());
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
