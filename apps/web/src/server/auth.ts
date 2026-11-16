import { getDb } from './db';
import { readWebEnv } from './env';
import { createMailer, type Mailer } from './mail';
import { createAuth, type Auth } from './auth/options';

export { createAuth, type Auth } from './auth/options';

let mailer: Mailer | undefined;

/** The app's mailer, built on first use: one per server process. */
export function getMailer(): Mailer {
  mailer ??= createMailer(readWebEnv());
  return mailer;
}

let auth: Auth | undefined;

/** The app's Better Auth instance, built on first use. */
export function getAuth(): Auth {
  auth ??= createAuth({ db: getDb(), env: readWebEnv(), mail: getMailer() });
  return auth;
}
