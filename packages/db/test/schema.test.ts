import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../src/testing';

const { client } = useTestDatabase();

const insertAccount = (id: string, email: string) =>
  client.query(
    `insert into accounts (id, email, display_name, created_at, updated_at)
     values ($1, $2, '', now(), now())`,
    [id, email],
  );

describe('the accounts schema', () => {
  it('defaults a new account to Lithuanian, free, not admin, not onboarded', async () => {
    await insertAccount('a1', 'ruta@example.lt');
    const { rows } = await client.query(
      'select locale, entitlement, admin, disabled_at, onboarded_at from accounts',
    );
    expect(rows).toEqual([
      {
        locale: 'lt',
        entitlement: 'free',
        admin: false,
        disabled_at: null,
        onboarded_at: null,
      },
    ]);
  });

  it('refuses a locale outside Lithuanian and English', async () => {
    await expect(
      client.query(
        `insert into accounts (id, email, display_name, locale, created_at, updated_at)
         values ('a1', 'ruta@example.lt', '', 'de', now(), now())`,
      ),
    ).rejects.toThrow(/check/);
  });

  it('refuses an entitlement that does not exist', async () => {
    await expect(
      client.query(
        `insert into accounts (id, email, display_name, entitlement, created_at, updated_at)
         values ('a1', 'ruta@example.lt', '', 'pro', now(), now())`,
      ),
    ).rejects.toThrow(/check/);
  });

  it('refuses an audit row for an unknown admin action', async () => {
    await expect(
      client.query(
        `insert into admin_audit (action, target_account_id, target_email, actor, at)
         values ('delete-everything', 'a1', 'ruta@example.lt', 'cli', now())`,
      ),
    ).rejects.toThrow(/check/);
  });

  it.each([['Ruta@Example.lt'], [' ruta@example.lt'], ['ruta@example.lt ']])(
    'refuses the non-canonical email %j',
    async (email) => {
      await expect(insertAccount('a1', email)).rejects.toThrow(
        /accounts_email_canonical/,
      );
    },
  );

  it.each([
    ['fullwidth letters', 'ｒｕｔａ@example.lt'],
    ['a Cyrillic a', 'ruta@exаmple.lt'],
  ])('refuses an email with %s', async (_, email) => {
    await expect(insertAccount('a1', email)).rejects.toThrow(
      /accounts_email_canonical/,
    );
  });

  it('accepts a canonical email', async () => {
    await insertAccount('a1', 'ruta@example.lt');
    const { rows } = await client.query('select email from accounts');
    expect(rows).toEqual([{ email: 'ruta@example.lt' }]);
  });

  it('refuses a second account with the same email', async () => {
    await insertAccount('a1', 'ruta@example.lt');
    await expect(insertAccount('a2', 'ruta@example.lt')).rejects.toThrow(
      /unique/,
    );
  });

  it('removes sessions and provider links with their account', async () => {
    await insertAccount('a1', 'ruta@example.lt');
    await client.query(
      `insert into sessions (id, token, account_id, expires_at, created_at, updated_at)
       values ('s1', 't1', 'a1', now() + interval '1 day', now(), now())`,
    );
    await client.query(
      `insert into provider_accounts (id, provider_account_id, provider_id, account_id, created_at, updated_at)
       values ('p1', 'lichess-ruta', 'lichess', 'a1', now(), now())`,
    );
    await client.query(`delete from accounts where id = 'a1'`);
    const { rows } = await client.query(
      'select (select count(*) from sessions)::int as s, (select count(*) from provider_accounts)::int as p',
    );
    expect(rows).toEqual([{ s: 0, p: 0 }]);
  });

  it('keeps audit rows after the account is gone (no cascade)', async () => {
    await insertAccount('a1', 'ruta@example.lt');
    await client.query(
      `insert into admin_audit (action, target_account_id, target_email, actor, at)
       values ('grant-admin', 'a1', 'ruta@example.lt', 'cli', now())`,
    );
    await client.query(`delete from accounts where id = 'a1'`);
    const { rows } = await client.query(
      'select count(*)::int as n from admin_audit',
    );
    expect(rows).toEqual([{ n: 1 }]);
  });
});

describe('the rate limits schema', () => {
  const insertLimit = (id: string, key: string, lastRequest: number) =>
    client.query(
      `insert into rate_limits (id, key, count, last_request)
       values ($1, $2, 1, $3)`,
      [id, key, lastRequest],
    );

  it('keeps one counter per key, with the last request in epoch milliseconds', async () => {
    const lastRequest = Date.UTC(2026, 9, 16, 12, 0, 0, 123);
    await insertLimit('r1', '203.0.113.7/sign-in/magic-link', lastRequest);
    const { rows } = await client.query(
      'select key, count, last_request::text as last_request from rate_limits',
    );
    expect(rows).toEqual([
      {
        key: '203.0.113.7/sign-in/magic-link',
        count: 1,
        last_request: String(lastRequest),
      },
    ]);
  });

  it('refuses a second counter for the same key', async () => {
    await insertLimit('r1', '203.0.113.7/sign-in/magic-link', 1);
    await expect(
      insertLimit('r2', '203.0.113.7/sign-in/magic-link', 2),
    ).rejects.toThrow(/unique/);
  });
});
