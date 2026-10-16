import type { GoogleProfile } from 'better-auth/social-providers';
import { z } from 'zod';

// Only `sub`, `email` and `email_verified` decide anything. The rest default
// so the profile has the shape Better Auth types it with.
const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  email_verified: z.literal(true),
  name: z.string().default(''),
  picture: z.string().optional(),
  given_name: z.string().default(''),
  family_name: z.string().default(''),
  aud: z.string().default(''),
  azp: z.string().default(''),
  iss: z.string().default(''),
  exp: z.number().default(0),
  iat: z.number().default(0),
});

export interface GoogleUserInfo {
  readonly user: {
    email: string;
    name: string;
    image: string | undefined;
    emailVerified: true;
  };
  readonly data: GoogleProfile;
}

// The payload segment of a JWT as JSON, or undefined when it is not one.
function jwtPayload(token: string | undefined): unknown {
  const payload = token?.split('.')[1];
  if (payload === undefined) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Google's identity from the id token that Google's token endpoint just
 * returned over TLS (so it is read, not re-verified). Only a verified email
 * is accepted (spec: "Google: verified email only"); `null` ends the
 * sign-in. Better Auth takes the provider account id from `data.sub`.
 */
export function googleUserInfo(tokens: {
  idToken?: string | undefined;
}): Promise<GoogleUserInfo | null> {
  const claims = claimsSchema.safeParse(jwtPayload(tokens.idToken));
  if (!claims.success) return Promise.resolve(null);
  const c = claims.data;
  return Promise.resolve({
    user: {
      email: c.email,
      name: c.name,
      image: c.picture,
      emailVerified: true,
    },
    data: { ...c, picture: c.picture ?? '' },
  });
}
