// A test file that drives code reading the mocked request (./request) sets
// it up here: a test database, and before each test a fresh signed-out
// request on a fresh test auth.
import {
  useTestDatabase,
  type TestDatabaseConnection,
} from '@mychess/db/testing';
import { beforeEach } from 'vitest';
import {
  buildTestAuth,
  type Profile,
  signInByMagicLink,
  signInOnboarded,
  type TestAuthOptions,
} from './auth';
import { built, request, resetRequest, testDb } from './request';
import { sqlOn, type SqlHelpers } from './rows';

export interface RequestHarness extends TestDatabaseConnection {
  readonly sql: SqlHelpers;
}

/** The test database, and a fresh mocked request before each test. */
export function useRequestHarness(): RequestHarness {
  const connection = useTestDatabase();
  beforeEach(() => {
    resetRequest(buildTestAuth(connection.db), connection.db);
  });
  return { ...connection, sql: sqlOn(connection.client) };
}

/** Rebuilds the request's auth with `options`, such as a fake provider fetch. */
export function rebuildAuth(options: TestAuthOptions): void {
  request.built = buildTestAuth(testDb(), options);
}

/** Signs `email` in by magic link; returns the session cookie. */
export function signIn(email: string): Promise<string> {
  return signInByMagicLink(built(), email);
}

/** Signs `email` in and onboards it as `displayName`; returns the cookie. */
export function onboarded(
  email: string,
  displayName: string,
  locale: Profile['locale'] = 'lt',
): Promise<string> {
  return signInOnboarded(built(), testDb(), email, { displayName, locale });
}
