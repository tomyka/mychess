import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

// This machine's Mailpit port lives in apps/web/.env.local (it may not be
// 8025, which another project's Mailpit can hold); nothing else is taken
// from that file.
const LOCAL_ENV_FILE = join(import.meta.dirname, '..', '..', '.env.local');
const LOCAL_MAILPIT_URL = existsSync(LOCAL_ENV_FILE)
  ? parseEnv(readFileSync(LOCAL_ENV_FILE, 'utf8'))['MAILPIT_URL']
  : undefined;

/**
 * The Mailpit the app under test sends through and the tests read: the
 * environment's (CI sets it), else .env.local's, else infra/compose.yaml's.
 * playwright.config.ts gives the app this same URL.
 */
export const MAILPIT_URL =
  process.env['MAILPIT_URL'] ?? LOCAL_MAILPIT_URL ?? 'http://127.0.0.1:8025';
