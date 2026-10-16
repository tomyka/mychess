import { afterEach, describe, expect, it, vi } from 'vitest';
import { readWebEnv, webEnvSchema } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/mychess',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  MAIL_TRANSPORT: 'mailpit',
  MAIL_FROM: 'mychess <noreply@mychess.test>',
  MAILPIT_URL: 'http://localhost:8025',
  LICHESS_CLIENT_ID: 'mychess-local',
};

// The base environment with one variable left out.
function without(key: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(base).filter(([name]) => name !== key),
  );
}

describe('webEnvSchema', () => {
  it('takes a local Mailpit environment and defaults to local, test sign-in off', () => {
    expect(webEnvSchema.parse(base)).toEqual({
      ...base,
      MYCHESS_ENV: 'local',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      MYCHESS_TEST_SIGNIN: false,
    });
  });

  it('takes the local, staging and production environments', () => {
    expect(
      webEnvSchema.parse({ ...base, MYCHESS_ENV: 'local' }).MYCHESS_ENV,
    ).toBe('local');
    expect(
      webEnvSchema.parse({ ...base, MYCHESS_ENV: 'staging' }).MYCHESS_ENV,
    ).toBe('staging');
    expect(
      webEnvSchema.parse({ ...base, MYCHESS_ENV: 'production' }).MYCHESS_ENV,
    ).toBe('production');
    expect(
      webEnvSchema.safeParse({ ...base, MYCHESS_ENV: 'dev' }).success,
    ).toBe(false);
  });

  it('refuses a secret shorter than 32 characters', () => {
    expect(
      webEnvSchema.safeParse({ ...base, BETTER_AUTH_SECRET: 'x'.repeat(31) })
        .success,
    ).toBe(false);
  });

  it('refuses an app URL that is not a URL', () => {
    expect(
      webEnvSchema.safeParse({ ...base, BETTER_AUTH_URL: 'localhost' }).success,
    ).toBe(false);
  });

  it.each(['DATABASE_URL', 'MAIL_TRANSPORT', 'MAIL_FROM', 'LICHESS_CLIENT_ID'])(
    'refuses an environment without %s',
    (key) => {
      expect(webEnvSchema.safeParse(without(key)).success).toBe(false);
    },
  );

  it('refuses an empty sender or Lichess client', () => {
    expect(webEnvSchema.safeParse({ ...base, MAIL_FROM: 'ab' }).success).toBe(
      false,
    );
    expect(webEnvSchema.safeParse({ ...base, MAIL_FROM: 'a@b' }).success).toBe(
      true,
    );
    expect(
      webEnvSchema.safeParse({ ...base, LICHESS_CLIENT_ID: '' }).success,
    ).toBe(false);
  });

  it('needs a Resend key when sending with Resend', () => {
    expect(
      webEnvSchema.safeParse({ ...base, MAIL_TRANSPORT: 'resend' }).success,
    ).toBe(false);
    expect(
      webEnvSchema.safeParse({
        ...base,
        MAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: '',
      }).success,
    ).toBe(false);
    expect(
      webEnvSchema.safeParse({
        ...base,
        MAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 're_x',
      }).success,
    ).toBe(true);
  });

  it('needs a Mailpit URL when sending with Mailpit', () => {
    const withoutMailpit = without('MAILPIT_URL');
    const result = webEnvSchema.safeParse(withoutMailpit);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ['MAILPIT_URL'],
    ]);
    expect(
      webEnvSchema.safeParse({
        ...withoutMailpit,
        MAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 'k',
      }).success,
    ).toBe(true);
  });

  it('names the missing Resend key', () => {
    const result = webEnvSchema.safeParse({
      ...base,
      MAIL_TRANSPORT: 'resend',
    });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ['RESEND_API_KEY'],
    ]);
  });

  it('needs a test secret of at least 32 characters when the test sign-in is on', () => {
    const result = webEnvSchema.safeParse({
      ...base,
      MYCHESS_TEST_SIGNIN: '1',
    });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ['TEST_SIGNIN_SECRET'],
    ]);
    expect(
      webEnvSchema.safeParse({
        ...base,
        MYCHESS_TEST_SIGNIN: '1',
        TEST_SIGNIN_SECRET: 's'.repeat(31),
      }).success,
    ).toBe(false);
    expect(
      webEnvSchema.parse({
        ...base,
        MYCHESS_TEST_SIGNIN: '1',
        TEST_SIGNIN_SECRET: 's'.repeat(32),
      }),
    ).toMatchObject({ MYCHESS_TEST_SIGNIN: true });
  });

  it('reads the test sign-in switch as off when it says so', () => {
    expect(
      webEnvSchema.parse({ ...base, MYCHESS_TEST_SIGNIN: '0' })
        .MYCHESS_TEST_SIGNIN,
    ).toBe(false);
  });
});

describe('readWebEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses the process environment', () => {
    for (const [key, value] of Object.entries(base)) vi.stubEnv(key, value);
    vi.stubEnv('MYCHESS_ENV', 'staging');
    expect(readWebEnv()).toMatchObject({
      MYCHESS_ENV: 'staging',
      MAIL_TRANSPORT: 'mailpit',
    });
  });

  it('throws when the process environment is incomplete', () => {
    for (const [key, value] of Object.entries(base)) vi.stubEnv(key, value);
    vi.stubEnv('BETTER_AUTH_SECRET', 'short');
    expect(() => readWebEnv()).toThrow();
  });
});
