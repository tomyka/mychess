import { deleteAccount } from '@mychess/db';
import { useTestDatabase } from '@mychess/db/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  buildTestAuth,
  type BuiltAuth,
  mailedLink,
  requestMagicLink,
  signInByMagicLink,
} from './support/auth';
import { MESSAGES } from '../../src/i18n/catalogue';
import { sqlOn } from './support/rows';

const { db, client } = useTestDatabase();
const { rows } = sqlOn(client);
const accountRows = () => rows('select email from accounts order by email');

const lastLink = (built: BuiltAuth): string => mailedLink(built) ?? '';

const SESSION_TOKEN = /session_token=[^;]+\./;

afterEach(() => {
  vi.useRealTimers();
});

describe('magic-link sign-in', () => {
  it('creates one account, on our defaults, and a session on first use', async () => {
    const built = buildTestAuth(db);
    const cookie = await signInByMagicLink(built, 'ruta@example.lt');
    const session = await built.auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session?.user.email).toBe('ruta@example.lt');
    expect(
      await rows(
        'select email, display_name, entitlement, admin from accounts',
      ),
    ).toEqual([
      {
        email: 'ruta@example.lt',
        display_name: '',
        entitlement: 'free',
        admin: false,
      },
    ]);
    expect(
      await rows(
        'select count(*)::int as n from sessions s join accounts a on a.id = s.account_id',
      ),
    ).toEqual([{ n: 1 }]);
  });

  it.each([
    ['RUTA@EXAMPLE.LT'],
    ['  Ruta@Example.lt '],
    ['ｒｕｔａ@ｅｘａｍｐｌｅ.ｌｔ'],
  ])('signs %j into the same account (security item 6)', async (variant) => {
    const built = buildTestAuth(db);
    await signInByMagicLink(built, 'ruta@example.lt');
    await signInByMagicLink(built, variant);
    expect(await accountRows()).toEqual([{ email: 'ruta@example.lt' }]);
  });

  it('creates the account canonical when its first link was typed in another form', async () => {
    const built = buildTestAuth(db);
    await signInByMagicLink(built, '  Ruta@Example.LT ');
    expect(await accountRows()).toEqual([{ email: 'ruta@example.lt' }]);
    expect(built.sent.at(-1)?.to).toBe('ruta@example.lt');
  });

  it('stores a mixed-case token under the canonical email, so hard delete finds it', async () => {
    const built = buildTestAuth(db);
    await signInByMagicLink(built, 'ruta@example.lt');
    await requestMagicLink(built, { email: '  Ruta@Example.LT ' });
    const values = z
      .array(z.object({ value: z.string() }))
      .parse(await rows('select value from verifications'));
    expect(
      values.map(
        (v) =>
          z.looseObject({ email: z.string() }).parse(JSON.parse(v.value)).email,
      ),
    ).toEqual(['ruta@example.lt']);
    const [account] = z
      .array(z.object({ id: z.string() }))
      .parse(await rows('select id from accounts'));
    await deleteAccount(db, account?.id ?? '');
    expect(await rows('select count(*)::int as n from verifications')).toEqual([
      { n: 0 },
    ]);
  });

  it('refuses a Cyrillic look-alike without sending mail, a token or an account', async () => {
    const built = buildTestAuth(db);
    const response = await requestMagicLink(built, {
      email: 'ruta@exаmple.lt',
    });
    expect(response.status).toBe(400);
    expect(built.sent).toEqual([]);
    expect(await rows('select count(*)::int as n from verifications')).toEqual([
      { n: 0 },
    ]);
    expect(await accountRows()).toEqual([]);
  });

  it('does not let the request name the new account (R-81)', async () => {
    const built = buildTestAuth(db);
    await requestMagicLink(built, {
      email: 'ruta@example.lt',
      name: 'Evil <script>',
      callbackURL: '/',
    });
    await built.auth.handler(new Request(lastLink(built)));
    expect(await rows('select email, display_name from accounts')).toEqual([
      { email: 'ruta@example.lt', display_name: '' },
    ]);
  });

  it('uses a link once only', async () => {
    const built = buildTestAuth(db);
    await signInByMagicLink(built, 'ruta@example.lt');
    const again = await built.auth.handler(new Request(lastLink(built)));
    expect(again.headers.getSetCookie().join()).not.toMatch(SESSION_TOKEN);
    expect(await rows('select count(*)::int as n from sessions')).toEqual([
      { n: 1 },
    ]);
  });

  it('refuses a link followed after 15 minutes (security item 6)', async () => {
    const built = buildTestAuth(db);
    await requestMagicLink(built, {
      email: 'ruta@example.lt',
      callbackURL: '/',
    });
    vi.useFakeTimers({
      now: Date.now() + 15 * 60_000 + 1000,
      toFake: ['Date'],
    });
    const late = await built.auth.handler(new Request(lastLink(built)));
    expect(late.headers.getSetCookie().join()).not.toMatch(SESSION_TOKEN);
    expect(await rows('select count(*)::int as n from sessions')).toEqual([
      { n: 0 },
    ]);
    expect(await accountRows()).toEqual([]);
  });

  it('stores the link token hashed, never as mailed', async () => {
    const built = buildTestAuth(db);
    await requestMagicLink(built, {
      email: 'ruta@example.lt',
      callbackURL: '/',
    });
    const token = new URL(lastLink(built)).searchParams.get('token') ?? '';
    expect(token).not.toBe('');
    const stored = z
      .array(z.object({ identifier: z.string(), value: z.string() }))
      .parse(await rows('select identifier, value from verifications'));
    expect(stored).toHaveLength(1);
    for (const { identifier, value } of stored) {
      expect(identifier).not.toContain(token);
      expect(value).not.toContain(token);
    }
  });

  it('mails the link in English, naming no language', async () => {
    const built = buildTestAuth(db);
    await requestMagicLink(built, { email: 'ruta@example.lt' });
    expect(built.sent.map((m) => m.subject)).toEqual([
      MESSAGES.mail.magicLink.subject,
    ]);
    expect(new URL(lastLink(built)).searchParams.has('lang')).toBe(false);
  });
});
