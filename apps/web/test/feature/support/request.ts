// The Next.js request a feature test drives a server action, page helper or
// route handler with, and the mocked modules that read it.
//
// vi.mock is hoisted per test file, so each file declares its mocks and
// takes their bodies from here through a dynamic import:
//
//   vi.mock('next/headers', async () =>
//     (await import('./support/request')).nextHeaders());
//
// Only type imports of the app here: the server/auth mock imports this
// module while that module is being mocked, so a runtime import of it (or
// of ./auth, which imports it) would wait on itself.
import type { Db } from '@mychess/db';
import type * as ServerAuth from '../../../src/server/auth';
import type { MailMessage } from '../../../src/server/mail';
import type { BuiltAuth } from './auth';

/** A cookie the code under test set (or, with `deleted`, deleted). */
export interface SetCookie {
  readonly name: string;
  readonly value: string;
  readonly options: Record<string, unknown>;
}

/** What the mocked request carries and what the code under test did with it. */
export interface MockedRequest {
  /** The Cookie header; `cookies()` reads the same pairs. */
  cookie: string;
  /** The cookies set or deleted, in order. */
  set: SetCookie[];
  /** The mail sent through `getMailer()`, oldest first. */
  mailed: MailMessage[];
  /** Makes `getMailer().send` fail, as a mail outage would. */
  mailFails: boolean;
  /** How many times `refresh()` (next/cache) was called. */
  refreshed: number;
  /** The auth `getAuth()` answers with. */
  built?: BuiltAuth;
  /** The database `getDb()` answers with. */
  db?: Db;
}

/** The one mocked request of this test file (modules are per file). */
export const request: MockedRequest = {
  cookie: '',
  set: [],
  mailed: [],
  mailFails: false,
  refreshed: 0,
};

/** A fresh request, signed out, on `built` and `db`. */
export function resetRequest(built: BuiltAuth, db: Db): void {
  Object.assign(request, {
    cookie: '',
    set: [],
    mailed: [],
    mailFails: false,
    refreshed: 0,
    built,
    db,
  });
}

/** The auth the request is checked against. */
export function built(): BuiltAuth {
  if (request.built === undefined) throw new Error('no test auth was built');
  return request.built;
}

/** The database the request's code reads. */
export function testDb(): Db {
  if (request.db === undefined) throw new Error('no test database was set');
  return request.db;
}

/** The value of cookie `name` in the request's Cookie header. */
function cookieValue(name: string): string | undefined {
  return request.cookie
    .split('; ')
    .find((pair) => pair.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** Sets cookie `name` in the request's Cookie header, as a browser would. */
export function setRequestCookie(name: string, value: string): void {
  request.cookie = [
    ...request.cookie
      .split('; ')
      .filter((pair) => pair !== '' && !pair.startsWith(`${name}=`)),
    `${name}=${value}`,
  ].join('; ');
}

/** The error the mocked `redirect` throws, naming where it sends. */
export class Redirected extends Error {
  readonly to: string;

  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}

/** The error the mocked `notFound` throws: the page answers 404. */
export class NotFound extends Error {
  constructor() {
    super('not found');
  }
}

/** What a thrown navigation stands for in an outcome; anything else as is. */
function navigationOutcome(error: unknown): unknown {
  if (error instanceof Redirected) return { redirectedTo: error.to };
  return error instanceof NotFound ? { notFound: true } : error;
}

/**
 * What `promise` came to: its value, `{ redirectedTo }`,
 * `{ notFound: true }`, or the error.
 */
export const outcomeOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then((state) => state, navigationOutcome);

/** The cookie store the mocked `cookies()` answers with. */
interface CookieStore {
  readonly get: (name: string) => { name: string; value: string } | undefined;
  readonly set: (
    name: string,
    value: string,
    options: Record<string, unknown>,
  ) => void;
  readonly delete: (name: string) => void;
}

/** The body of a `next/headers` mock that reads `request`. */
export function nextHeaders(): {
  headers: () => Promise<Headers>;
  cookies: () => Promise<CookieStore>;
} {
  return {
    headers: () => Promise.resolve(new Headers({ cookie: request.cookie })),
    cookies: () =>
      Promise.resolve({
        get: (name: string) => {
          const value = cookieValue(name);
          return value === undefined ? undefined : { name, value };
        },
        set: (
          name: string,
          value: string,
          options: Record<string, unknown>,
        ) => {
          request.set.push({ name, value, options });
        },
        delete: (name: string) => {
          request.set.push({ name, value: '', options: { deleted: true } });
        },
      }),
  };
}

/**
 * The body of a `next/navigation` mock whose `redirect` throws Redirected
 * and whose `notFound` throws NotFound.
 */
export function nextNavigation(): {
  redirect: (to: string) => never;
  notFound: () => never;
} {
  return {
    redirect: (to: string) => {
      throw new Redirected(to);
    },
    notFound: () => {
      throw new NotFound();
    },
  };
}

/** The body of a `next/cache` mock that counts refreshes. */
export function nextCache(): { refresh: () => void } {
  return {
    refresh: () => {
      request.refreshed += 1;
    },
  };
}

/** The body of a `src/server/db` mock: `getDb()` is the test database. */
export function serverDb(): { getDb: () => Db } {
  return { getDb: testDb };
}

/**
 * The body of a partial `src/server/auth` mock: `getAuth()` is the
 * request's test auth and `getMailer()` keeps what it sends in `mailed`.
 */
export async function serverAuth(
  importOriginal: <T>() => Promise<T>,
): Promise<typeof ServerAuth> {
  return {
    ...(await importOriginal<typeof ServerAuth>()),
    getAuth: () => built().auth,
    getMailer: () => ({
      send: (message: MailMessage) => {
        if (request.mailFails) return Promise.reject(new Error('mail: down'));
        request.mailed.push(message);
        return Promise.resolve();
      },
    }),
  };
}
