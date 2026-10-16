import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '../../../../server/auth';

// Better Auth's endpoints. The instance is built on the first request, not at
// import, so `next build` needs no environment.
export const { GET, POST } = toNextJsHandler((request: Request) =>
  getAuth().handler(request),
);
