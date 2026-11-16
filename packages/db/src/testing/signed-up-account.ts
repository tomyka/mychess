import type { accounts } from '../schema';

/**
 * The account row as Better Auth creates it on a sign-up (apps/web
 * test-sign-in.ts): the given email, verified, no name, created and updated
 * at `at`. Fixtures spread it and override what their setup needs (a name,
 * onboarding, Coach mode) before inserting it.
 */
export function signedUpAccount({
  id,
  email,
  at,
}: {
  readonly id: string;
  readonly email: string;
  readonly at: Date;
}): typeof accounts.$inferInsert {
  return {
    id,
    email,
    emailVerified: true,
    displayName: '',
    createdAt: at,
    updatedAt: at,
  };
}
