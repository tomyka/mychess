import { getAuth } from '../../../../server/auth';
import { readWebEnv } from '../../../../server/env';
import { testSignIn } from '../../../../server/test-sign-in';

/** Persona sign-in, local only (R-73, R-93); 404 wherever it is off. */
export function POST(request: Request): Promise<Response> {
  return testSignIn(request, { env: readWebEnv(), auth: getAuth() });
}
