import { userInfo } from 'node:os';
import { canonicalEmail, type AdminRefusal } from '@mychess/domain';
import type { grantAdmin } from '../admin';
import { createDb } from '../client';
import { databaseEnvSchema } from '../config';
import type { Result } from '@mychess/chess';
import { z } from 'zod';

/**
 * The admin CLI's environment: the database, plus the key its audit rows'
 * email hashes are keyed with (R-94), a per-environment random secret.
 */
const adminEnvSchema = databaseEnvSchema.extend({
  AUDIT_EMAIL_KEY: z.string().min(32),
});

/** `grantAdmin` or `disableAccount`: one audited Admin change. */
type AdminCommand = (
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
 * The body of the admin:grant and admin:disable scripts: reads
 * DATABASE_URL and AUDIT_EMAIL_KEY (throwing before any connection when
 * either is missing or invalid), canonicalises the email in argv[2], runs
 * `change` as the `cliActor` with the key, prints `admin: <done> <email>` or
 * the refusal reason on stderr with exit code 1.
 */
export async function runAdminCommand(
  command: string,
  done: string,
  change: AdminCommand,
): Promise<void> {
  const env = adminEnvSchema.parse(process.env);
  const email = canonicalEmail(process.argv[2] ?? '');
  if (!email.ok) {
    process.stderr.write(`${command}: ${email.refusal.reason}\n`);
    process.exitCode = 1;
    return;
  }
  const { db, close } = createDb(env.DATABASE_URL);
  try {
    const result = await change(db, {
      email: email.value,
      actor: cliActor(),
      now: new Date(),
      key: env.AUDIT_EMAIL_KEY,
    });
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
