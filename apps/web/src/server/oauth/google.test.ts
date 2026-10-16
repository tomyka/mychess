import { describe, expect, it } from 'vitest';
import { googleUserInfo } from './google';

const idToken = (claims: object) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

describe('googleUserInfo', () => {
  it('maps a verified Google identity', async () => {
    const info = await googleUserInfo({
      idToken: idToken({
        sub: 'g1',
        email: 'Ruta@Example.lt',
        email_verified: true,
        name: 'Rūta',
        picture: 'p',
      }),
    });
    expect(info?.data.sub).toBe('g1');
    expect(info?.user).toEqual({
      email: 'Ruta@Example.lt',
      name: 'Rūta',
      image: 'p',
      emailVerified: true,
    });
  });

  it('leaves the name blank when Google gives none', async () => {
    const info = await googleUserInfo({
      idToken: idToken({ sub: 'g1', email: 'r@e.lt', email_verified: true }),
    });
    expect(info?.user).toEqual({
      email: 'r@e.lt',
      name: '',
      image: undefined,
      emailVerified: true,
    });
  });

  it.each([
    [
      'an unverified email',
      { sub: 'g1', email: 'r@e.lt', email_verified: false },
    ],
    ['no email', { sub: 'g1', email_verified: true }],
    ['no subject', { email: 'r@e.lt', email_verified: true }],
  ])('refuses %s', async (_, claims) => {
    expect(await googleUserInfo({ idToken: idToken(claims) })).toBeNull();
  });

  it('refuses a response without an id token', async () => {
    expect(await googleUserInfo({})).toBeNull();
  });

  it.each([['not-a-jwt'], ['e30.bm90IGpzb24.sig']])(
    'refuses the malformed id token %j',
    async (token) => {
      expect(await googleUserInfo({ idToken: token })).toBeNull();
    },
  );
});
