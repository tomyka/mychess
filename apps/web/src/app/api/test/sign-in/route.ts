import { getAuth } from '../../../../server/auth';
import { readWebEnv } from '../../../../server/env';
import { testSignIn } from '../../../../server/test-sign-in';

/** Persona sign-in for local and staging (R-73); 404 wherever it is off. */
export function POST(request: Request): Promise<Response> {
  return testSignIn(request, { env: readWebEnv(), auth: getAuth() });
}
