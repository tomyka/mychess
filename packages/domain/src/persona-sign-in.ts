import { ok, refuse, type Result } from '@mychess/chess';
import { canonicalEmail } from './account';

/** The only domain the persona sign-in accepts (docs/personas/, R-73). */
export const PERSONA_EMAIL_DOMAIN = '@mychess.test';

/** Message-catalogue keys for persona sign-in refusals. */
export const PERSONA_REFUSALS = {
  notAPersona: 'testSignIn.notAPersona',
} as const;

export interface PersonaRefusal {
  readonly reason: (typeof PERSONA_REFUSALS)[keyof typeof PERSONA_REFUSALS];
}

/**
 * A persona's canonical email (R-73, R-93): only an address that ends with
 * the persona domain once canonical; anything else, an invalid email
 * included, is not a persona.
 */
export function personaEmail(raw: string): Result<string, PersonaRefusal> {
  const email = canonicalEmail(raw);
  return email.ok && email.value.endsWith(PERSONA_EMAIL_DOMAIN)
    ? ok(email.value)
    : refuse(PERSONA_REFUSALS.notAPersona);
}

/**
 * Whether the persona sign-in exists (R-73, R-93): never in production, and
 * elsewhere only when switched on.
 */
export function personaSignInAvailable(env: {
  readonly production: boolean;
  readonly switchedOn: boolean;
}): boolean {
  return !env.production && env.switchedOn;
}
