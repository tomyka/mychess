import { databaseEnvSchema } from '../config';
import { MIGRATIONS_FOLDER, runMigrations } from '../migrations';

const env = databaseEnvSchema.parse(process.env);
await runMigrations(env.DATABASE_URL, MIGRATIONS_FOLDER);
process.stdout.write('migrations: applied\n');
