import { createDb } from '../../client';
import { seedTarget, type SeedEnv } from './guard';
import { seedPersonas } from './seed';

/**
 * The body of the seed:personas script (R-32, R-168): refuses, with exit
 * code 1 and before connecting, unless the environment and the database
 * are local (seedTarget); otherwise seeds the personas as of `now` and
 * prints what it made and how many reviews each persona has due.
 */
export async function runSeedPersonas(
  env: SeedEnv = process.env,
  now: Date = new Date(),
): Promise<void> {
  const target = seedTarget(env);
  if (!target.ok) {
    process.stderr.write(`seed:personas: ${target.refusal.reason}\n`);
    process.exitCode = 1;
    return;
  }
  const { db, close } = createDb(target.value);
  try {
    const summary = await seedPersonas(db, now);
    process.stdout.write(
      `seed:personas: ${String(summary.accounts)} accounts, ${String(summary.repertoires)} repertoires\n`,
    );
    for (const [email, due] of Object.entries(summary.due))
      process.stdout.write(`  ${email}: ${String(due)} due\n`);
  } finally {
    await close();
  }
}
