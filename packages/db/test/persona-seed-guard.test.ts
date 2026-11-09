import { describe, expect, it } from 'vitest';
import { SEED_REFUSALS, seedTarget } from '../src/testing/personas/guard';

const LOCAL_URL = 'postgres://mychess:mychess@localhost:5432/mychess';

describe('seedTarget (R-168: persona seeds on the local stack only)', () => {
  it.each([
    ['localhost', LOCAL_URL],
    ['localhost in capitals', 'postgres://m:m@LocalHost:5432/mychess'],
    ['127.0.0.1', 'postgresql://m:m@127.0.0.1:55432/mychess'],
    ['::1', 'postgres://m:m@[::1]:5432/mychess'],
    [
      'the Docker host from a container',
      'postgres://m:m@host.docker.internal/x',
    ],
  ])('allows a local database (%s) with MYCHESS_ENV local', (_case, url) => {
    expect(seedTarget({ MYCHESS_ENV: 'local', DATABASE_URL: url })).toEqual({
      ok: true,
      value: url,
    });
  });

  it('refuses an unset MYCHESS_ENV (the production admin container sets none)', () => {
    expect(seedTarget({ DATABASE_URL: LOCAL_URL })).toEqual({
      ok: false,
      refusal: { reason: SEED_REFUSALS.notLocalEnv },
    });
  });

  it.each(['production', 'staging', '', 'LOCAL', 'local '])(
    'refuses MYCHESS_ENV %j, whatever the database',
    (value) => {
      expect(
        seedTarget({ MYCHESS_ENV: value, DATABASE_URL: LOCAL_URL }),
      ).toEqual({ ok: false, refusal: { reason: SEED_REFUSALS.notLocalEnv } });
    },
  );

  it.each([
    ['the production compose service', 'postgres://m:m@postgres:5432/mychess'],
    ['a remote host', 'postgres://m:m@db.example.com:5432/mychess'],
    ['a private address', 'postgres://m:m@10.0.0.5:5432/mychess'],
    ['another loopback address', 'postgres://m:m@127.0.0.2:5432/mychess'],
    ['a localhost lookalike', 'postgres://m:m@localhost.example.com/x'],
    ['no host (pg would fall back to PGHOST)', 'postgres:///mychess'],
    ['a host query parameter', `${LOCAL_URL}?host=db.example.com`],
    ['a hostaddr query parameter', `${LOCAL_URL}?hostaddr=10.0.0.5`],
  ])('refuses a database that is not local: %s', (_case, url) => {
    expect(seedTarget({ MYCHESS_ENV: 'local', DATABASE_URL: url })).toEqual({
      ok: false,
      refusal: { reason: SEED_REFUSALS.notLocalDatabase },
    });
  });

  it.each([
    ['missing', undefined],
    ['not a URL', 'localhost:5432'],
    ['not Postgres', 'mysql://m:m@localhost/x'],
  ])('refuses a DATABASE_URL that is %s', (_case, url) => {
    expect(seedTarget({ MYCHESS_ENV: 'local', DATABASE_URL: url })).toEqual({
      ok: false,
      refusal: { reason: SEED_REFUSALS.databaseUrlInvalid },
    });
  });

  it('names its refusals with message keys', () => {
    expect(SEED_REFUSALS).toEqual({
      notLocalEnv: 'seed.notLocalEnv',
      databaseUrlInvalid: 'seed.databaseUrlInvalid',
      notLocalDatabase: 'seed.notLocalDatabase',
    });
  });
});
