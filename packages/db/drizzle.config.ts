import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/schema.ts',
    './src/assignment-schema.ts',
    './src/training-schema.ts',
  ],
  out: './migrations',
  strict: true,
  verbose: true,
});
