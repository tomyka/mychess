import { useTestDatabase } from '@mychess/db/testing';
import { describe, expect, it } from 'vitest';
import { BASE, buildTestAuth, signInByMagicLink } from './support/auth';

const { db } = useTestDatabase();

// Better Auth endpoints mychess does not use: profile, email and deletion
// changes go through our own server actions, there are no passwords, and
// provider tokens never leave the server (decision 8).
describe('the Better Auth endpoints mychess does not use', () => {
  it.each([
    ['POST', '/update-user'],
    ['POST', '/delete-user'],
    ['GET', '/delete-user/callback'],
    ['POST', '/change-email'],
    ['POST', '/sign-up/email'],
    ['POST', '/sign-in/email'],
    ['GET', '/verify-email'],
    ['POST', '/send-verification-email'],
    ['POST', '/request-password-reset'],
    ['POST', '/reset-password'],
    ['POST', '/change-password'],
    ['POST', '/verify-password'],
    ['POST', '/update-session'],
    ['POST', '/get-access-token'],
    ['POST', '/refresh-token'],
    ['GET', '/account-info'],
  ])('answer %s %s with 404, even when signed in', async (method, path) => {
    const built = buildTestAuth(db);
    const cookie = await signInByMagicLink(built, 'ruta@example.lt');
    const response = await built.auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method,
        headers: { 'content-type': 'application/json', origin: BASE, cookie },
        ...(method === 'POST'
          ? { body: JSON.stringify({ providerId: 'lichess' }) }
          : {}),
      }),
    );
    expect(response.status).toBe(404);
  });
});
