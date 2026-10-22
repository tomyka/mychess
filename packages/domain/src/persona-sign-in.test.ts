import { describe, expect, it } from 'vitest';
import {
  PERSONA_EMAIL_DOMAIN,
  PERSONA_REFUSALS,
  personaEmail,
  personaSignInAvailable,
} from './persona-sign-in';

describe('persona sign-in vocabulary (R-73, R-93)', () => {
  it('accepts only the persona domain (docs/personas/)', () => {
    expect(PERSONA_EMAIL_DOMAIN).toBe('@mychess.test');
  });

  it('keys its refusal by message-catalogue key', () => {
    expect(PERSONA_REFUSALS).toEqual({ notAPersona: 'testSignIn.notAPersona' });
  });
});

describe('personaEmail (R-73, R-93)', () => {
  it('gives a persona its canonical email', () => {
    expect(personaEmail(' U1@MyChess.test ')).toEqual({
      ok: true,
      value: 'u1@mychess.test',
    });
  });

  it.each([
    'ruta@example.lt',
    'u1@mychess.test.evil.lt',
    'u1@evilmychess.test',
    '@mychess.test',
    'not an email',
  ])('refuses %j', (raw) => {
    expect(personaEmail(raw)).toEqual({
      ok: false,
      refusal: { reason: 'testSignIn.notAPersona' },
    });
  });
});

describe('personaSignInAvailable (R-73, R-93)', () => {
  it.each([
    [false, true, true],
    [false, false, false],
    [true, true, false],
    [true, false, false],
  ])(
    'in production %s, switched on %s, is available: %s',
    (production, switchedOn, available) => {
      expect(personaSignInAvailable({ production, switchedOn })).toBe(
        available,
      );
    },
  );
});
