import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleConfigured, readWebEnv, webEnvSchema } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/mychess',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  MAIL_TRANSPORT: 'mailpit',
  MAIL_FROM: 'mychess <noreply@mychess.test>',
  MAILPIT_URL: 'http://localhost:8025',
  LICHESS_CLIENT_ID: 'mychess-local',
};

// What production needs on top of the base (security A7).
const deployed = {
  ...base,
  BETTER_AUTH_URL: 'https://mychess.lt',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
};

// The base environment with one variable left out.
function without(key: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(base).filter(([name]) => name !== key),
  );
}

const issuePaths = (env: Record<string, string>) =>
  webEnvSchema.safeParse(env).error?.issues.map((issue) => issue.path) ?? [];

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

  it('takes the local and production environments', () => {
    expect(
      webEnvSchema.parse({ ...base, MYCHESS_ENV: 'local' }).MYCHESS_ENV,
    ).toBe('local');
    expect(
      webEnvSchema.parse({ ...deployed, MYCHESS_ENV: 'production' })
        .MYCHESS_ENV,
    ).toBe('production');
  });

  // There is no staging any more (R-166): its name is refused, not mapped.
  it.each(['staging', 'dev', 'Production', ''])(
    'refuses the environment %j',
    (name) => {
      expect(issuePaths({ ...deployed, MYCHESS_ENV: name })).toEqual([
        ['MYCHESS_ENV'],
      ]);
    },
  );

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

describe('webEnvSchema on production (security A7)', () => {
  it('takes an https app URL and both Google credentials', () => {
    expect(issuePaths({ ...deployed, MYCHESS_ENV: 'production' })).toEqual([]);
  });

  it('refuses an http app URL', () => {
    expect(
      issuePaths({
        ...deployed,
        MYCHESS_ENV: 'production',
        BETTER_AUTH_URL: 'http://mychess.lt',
      }),
    ).toEqual([['BETTER_AUTH_URL']]);
  });

  it('takes an http app URL locally', () => {
    expect(
      issuePaths({ ...deployed, BETTER_AUTH_URL: base.BETTER_AUTH_URL }),
    ).toEqual([]);
  });

  it.each(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])(
    'needs %s set',
    (key) => {
      expect(
        issuePaths({ ...deployed, MYCHESS_ENV: 'production', [key]: '' }),
      ).toEqual([[key]]);
    },
  );

  // R-73, R-93: production refuses the persona sign-in at start-up, not
  // only at request time.
  it.each(['1', 'true'])(
    'refuses the test sign-in switched on (%s) in production',
    (on) => {
      expect(
        issuePaths({
          ...deployed,
          MYCHESS_ENV: 'production',
          MYCHESS_TEST_SIGNIN: on,
          TEST_SIGNIN_SECRET: 's'.repeat(32),
        }),
      ).toEqual([['MYCHESS_TEST_SIGNIN']]);
    },
  );

  // #316, arch F4: the broadcast dump fixtures are for local E2E only.
  it('refuses a broadcast dump fixture directory in production', () => {
    expect(
      issuePaths({
        ...deployed,
        MYCHESS_ENV: 'production',
        FIDE_DUMP_FIXTURE_DIR: '/tmp/fixtures',
      }),
    ).toEqual([['FIDE_DUMP_FIXTURE_DIR']]);
  });

  it('takes a broadcast dump fixture directory locally', () => {
    expect(
      webEnvSchema.parse({ ...base, FIDE_DUMP_FIXTURE_DIR: '/tmp/fixtures' })
        .FIDE_DUMP_FIXTURE_DIR,
    ).toBe('/tmp/fixtures');
  });

  it('takes production with the test sign-in switched off', () => {
    expect(
      issuePaths({
        ...deployed,
        MYCHESS_ENV: 'production',
        MYCHESS_TEST_SIGNIN: '0',
      }),
    ).toEqual([]);
  });

  it('takes the test sign-in switched on with its secret locally', () => {
    expect(
      issuePaths({
        ...deployed,
        MYCHESS_ENV: 'local',
        MYCHESS_TEST_SIGNIN: '1',
        TEST_SIGNIN_SECRET: 's'.repeat(32),
      }),
    ).toEqual([]);
  });

  it('lets a local environment leave Google out', () => {
    expect(
      issuePaths({
        ...deployed,
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
      }),
    ).toEqual([]);
  });
});

// Security N1: a production build (`next start`, the image) that forgot
// MYCHESS_ENV refuses to start rather than running as local.
describe('webEnvSchema under a production build (fails closed)', () => {
  it('refuses NODE_ENV production without MYCHESS_ENV', () => {
    expect(issuePaths({ ...deployed, NODE_ENV: 'production' })).toEqual([
      ['MYCHESS_ENV'],
    ]);
  });

  it.each(['local', 'production'])(
    'takes NODE_ENV production with MYCHESS_ENV %s',
    (name) => {
      expect(
        webEnvSchema.parse({
          ...deployed,
          NODE_ENV: 'production',
          MYCHESS_ENV: name,
        }).MYCHESS_ENV,
      ).toBe(name);
    },
  );

  it.each(['development', 'test'])(
    'defaults to local under NODE_ENV %s',
    (nodeEnv) => {
      expect(
        webEnvSchema.parse({ ...base, NODE_ENV: nodeEnv }).MYCHESS_ENV,
      ).toBe('local');
    },
  );
});

describe('webEnvSchema secret', () => {
  it.each(['local', 'production'])(
    'refuses the .env.example placeholder secret on %s',
    (name) => {
      expect(
        issuePaths({
          ...deployed,
          MYCHESS_ENV: name,
          BETTER_AUTH_SECRET: 'change-me-to-32-or-more-random-characters',
        }),
      ).toEqual([['BETTER_AUTH_SECRET']]);
    },
  );
});

describe('readWebEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses the process environment', () => {
    for (const [key, value] of Object.entries(deployed)) vi.stubEnv(key, value);
    vi.stubEnv('MYCHESS_ENV', 'production');
    expect(readWebEnv()).toMatchObject({
      MYCHESS_ENV: 'production',
      MAIL_TRANSPORT: 'mailpit',
    });
  });

  it('throws when the process environment is incomplete', () => {
    for (const [key, value] of Object.entries(base)) vi.stubEnv(key, value);
    vi.stubEnv('BETTER_AUTH_SECRET', 'short');
    expect(() => readWebEnv()).toThrow();
  });
});

describe('googleConfigured', () => {
  it.each([
    ['google-client', 'google-secret', true],
    ['google-client', '', false],
    ['', 'google-secret', false],
    ['', '', false],
  ])('with id %j and secret %j is %s', (id, secret, configured) => {
    expect(
      googleConfigured({ GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret }),
    ).toBe(configured);
  });
});
