'use client';

import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Better Auth in the browser: sign-in, sign-out and provider links. */
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });
