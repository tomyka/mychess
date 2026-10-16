import { getAuth, signInForTest } from '../../../../server/auth';
import { readWebEnv } from '../../../../server/env';
import { testSignIn } from '../../../../server/test-sign-in';

/** Persona sign-in for staging (R-73); answers 404 wherever it is off. */
export function POST(request: Request): Promise<Response> {
  return testSignIn(request, {
    env: readWebEnv(),
    signIn: (email) => signInForTest(getAuth(), email),
  });
}
