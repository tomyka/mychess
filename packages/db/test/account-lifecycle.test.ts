import { describe, expect, it } from 'vitest';
import {
  assign,
  completeOnboarding,
  deleteConfirmedAccount,
  disableAccount,
} from '../src';
import { TEST_AUDIT_EMAIL_KEY, useTestDatabase } from '../src/testing';
import { seedAccount } from './support/accounts';
import { seedRepertoire } from './support/assignments';
import {
  openTransaction,
  seedCoach,
  seedLink,
  seedPlayer,
  someoneWaitsForALock,
} from './support/coaching';

/**
 * #267: each lifecycle transition is decided by the domain on the locked
 * account row, so two requests racing on one account cannot both pass a
 * check made on what they read before (spec decision 7).
 */

const { db, client } = useTestDatabase();
const T0 = new Date('2026-10-16T08:00:00Z');
const NOW = new Date('2026-10-22T09:00:00Z');
const LATER = new Date('2026-10-22T10:00:00Z');
const OK = { ok: true, value: undefined };
const refused = (reason: string) => ({ ok: false, refusal: { reason } });

const query = async (
  text: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> =>
  (await client.query<Record<string, unknown>>(text, params)).rows;

const allAccounts = () => query('select * from accounts order by id');

/**
 * Holds `a1`'s row locked while `racers` start, waits until all of them wait
 * for it, then lets them go: they contend for the row whatever they read
 * before it.
 */
async function race<T>(racers: (() => Promise<T>)[]): Promise<T[]> {
  const holder = await openTransaction(client, [
    `select 1 from accounts where id = 'a1' for update`,
  ]);
  const running = racers.map((run) => run());
  await someoneWaitsForALock(client, racers.length);
  await holder.finish();
  return Promise.all(running);
}

describe('completeOnboarding under the lock (R-81)', () => {
  const RUTA = { displayName: 'Rūta', locale: 'en' } as const;

  it('onboards a new account: its name, language and times, nobody else', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await seedAccount(db, 'a2', 'jonas@example.lt');
    expect(await completeOnboarding(db, 'a1', RUTA, NOW)).toEqual(OK);
    expect(
      await query(
        'select id, display_name, locale, onboarded_at, updated_at from accounts order by id',
      ),
    ).toEqual([
      {
        id: 'a1',
        display_name: 'Rūta',
        locale: 'en',
        onboarded_at: NOW,
        updated_at: NOW,
      },
      {
        id: 'a2',
        display_name: 'a2',
        locale: 'lt',
        onboarded_at: null,
        updated_at: T0,
      },
    ]);
  });

  it('refuses an onboarded account and writes nothing', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await query(`update accounts set onboarded_at = $1 where id = 'a1'`, [T0]);
    const before = await allAccounts();
    expect(await completeOnboarding(db, 'a1', RUTA, NOW)).toEqual(
      refused('lifecycle.alreadyOnboarded'),
    );
    expect(await allAccounts()).toEqual(before);
  });

  it.each([
    ['not onboarded', null],
    ['onboarded', T0],
  ])(
    'refuses a disabled account (%s) as closed and writes nothing (R-80)',
    async (_, onboardedAt) => {
      await seedAccount(db, 'a1', 'ruta@example.lt');
      await query(
        `update accounts set disabled_at = $1, onboarded_at = $2 where id = 'a1'`,
        [T0, onboardedAt],
      );
      const before = await allAccounts();
      expect(await completeOnboarding(db, 'a1', RUTA, NOW)).toEqual(
        refused('lifecycle.accountClosed'),
      );
      expect(await allAccounts()).toEqual(before);
    },
  );

  it('refuses an unknown account as closed and writes nothing', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    const before = await allAccounts();
    expect(await completeOnboarding(db, 'nobody', RUTA, NOW)).toEqual(
      refused('lifecycle.accountClosed'),
    );
    expect(await allAccounts()).toEqual(before);
  });

  it('onboards once when two submits race: the other is refused and the first one stays', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    const results = await race([
      () => completeOnboarding(db, 'a1', RUTA, NOW),
      () =>
        completeOnboarding(
          db,
          'a1',
          { displayName: 'Jonas', locale: 'lt' },
          LATER,
        ),
    ]);
    const winners = results.flatMap((result, i) => (result.ok ? [i] : []));
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      refused('lifecycle.alreadyOnboarded'),
    ]);
    const stored =
      winners[0] === 0
        ? { display_name: 'Rūta', locale: 'en', onboarded_at: NOW }
        : { display_name: 'Jonas', locale: 'lt', onboarded_at: LATER };
    expect(
      await query(
        `select display_name, locale, onboarded_at from accounts where id = 'a1'`,
      ),
    ).toEqual([stored]);
  });
});

describe('disableAccount under the lock (R-80)', () => {
  const disable = (now: Date) => () =>
    disableAccount(db, {
      email: 'ruta@example.lt',
      actor: 'ops',
      now,
      key: TEST_AUDIT_EMAIL_KEY,
    });

  it('disables and audits once when two runs race: the other is refused', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    const results = await race([disable(NOW), disable(LATER)]);
    const winners = results.flatMap((result, i) => (result.ok ? [i] : []));
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      refused('admin.alreadyDisabled'),
    ]);
    const at = winners[0] === 0 ? NOW : LATER;
    expect(
      await query(
        `select disabled_at, updated_at from accounts where id = 'a1'`,
      ),
    ).toEqual([{ disabled_at: at, updated_at: at }]);
    expect(
      await query('select action, target_account_id, at from admin_audit'),
    ).toEqual([{ action: 'disable-account', target_account_id: 'a1', at }]);
    expect(await query('select id from sessions')).toEqual([]);
  });
});

describe('deleteConfirmedAccount (R-40, R-82, R-86, R-87)', () => {
  const RUTA_MAIL = { to: 'ruta@example.lt', locale: 'lt' };

  const counts = async (): Promise<unknown> =>
    (
      await query(`select
        (select count(*) from accounts)::int as accounts,
        (select count(*) from sessions)::int as sessions,
        (select count(*) from provider_accounts)::int as providers,
        (select count(*) from verifications)::int as verifications`)
    )[0];
  const EVERYTHING = {
    accounts: 2,
    sessions: 2,
    providers: 2,
    verifications: 2,
  };
  const ONLY_JONAS = {
    accounts: 1,
    sessions: 1,
    providers: 1,
    verifications: 1,
  };

  /** Rūta (a1), with a session, a link and a magic link; Jonas (a2) beside her. */
  async function seedRuta(onboardedAt: Date | null = T0): Promise<void> {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await seedAccount(db, 'a2', 'jonas@example.lt');
    await query(
      `update accounts set display_name = 'Rūta', onboarded_at = $1 where id = 'a1'`,
      [onboardedAt],
    );
  }

  const remaining = () => query('select id from accounts order by id');

  it('refuses a name that is not the display name and deletes nothing', async () => {
    await seedRuta();
    expect(
      await deleteConfirmedAccount(db, { id: 'a1', typed: 'Ruta', now: NOW }),
    ).toEqual(refused('account.deleteNameMismatch'));
    expect(await counts()).toEqual(EVERYTHING);
  });

  it('deletes on the display name: the account, its sessions, links and tokens, and mails a proven address', async () => {
    await seedRuta();
    expect(
      await deleteConfirmedAccount(db, { id: 'a1', typed: ' Rūta ', now: NOW }),
    ).toEqual({ ok: true, value: { confirmationMail: RUTA_MAIL } });
    expect(await counts()).toEqual(ONLY_JONAS);
    expect(await remaining()).toEqual([{ id: 'a2' }]);
    expect(await query('select id from verifications')).toEqual([
      { id: 'v-a2' },
    ]);
  });

  it('deletes an account with an unproven email but mails nobody (R-87)', async () => {
    await seedRuta();
    await query(`update accounts set email_verified = false where id = 'a1'`);
    expect(
      await deleteConfirmedAccount(db, { id: 'a1', typed: 'Rūta', now: NOW }),
    ).toEqual({ ok: true, value: { confirmationMail: null } });
    expect(await counts()).toEqual(ONLY_JONAS);
  });

  it('deletes an account that has not been onboarded on its email in another case (R-86)', async () => {
    await seedRuta(null);
    expect(
      await deleteConfirmedAccount(db, {
        id: 'a1',
        typed: ' Ruta@Example.LT ',
        now: NOW,
      }),
    ).toEqual({ ok: true, value: { confirmationMail: RUTA_MAIL } });
    expect(await counts()).toEqual(ONLY_JONAS);
  });

  it('decides on the locked row: an account onboarded meanwhile is not deleted on its email', async () => {
    await seedRuta(null);
    const onboarding = await openTransaction(client, [
      `update accounts set onboarded_at = '2026-10-22T08:00:00Z' where id = 'a1'`,
    ]);
    const deleting = deleteConfirmedAccount(db, {
      id: 'a1',
      typed: 'ruta@example.lt',
      now: NOW,
    });
    await someoneWaitsForALock(client);
    await onboarding.finish();
    expect(await deleting).toEqual(refused('account.deleteNameMismatch'));
    expect(await counts()).toEqual(EVERYTHING);
  });

  it('answers an unknown account with no mail and deletes nothing', async () => {
    await seedRuta();
    expect(
      await deleteConfirmedAccount(db, {
        id: 'nobody',
        typed: 'Rūta',
        now: NOW,
      }),
    ).toEqual({ ok: true, value: { confirmationMail: null } });
    expect(await counts()).toEqual(EVERYTHING);
  });

  it('deletes once and mails once when two confirmations race', async () => {
    await seedRuta();
    const confirm = () =>
      deleteConfirmedAccount(db, { id: 'a1', typed: 'Rūta', now: NOW });
    const results = await race([confirm, confirm]);
    expect(results).toHaveLength(2);
    expect(results).toEqual(
      expect.arrayContaining([
        { ok: true, value: { confirmationMail: RUTA_MAIL } },
        { ok: true, value: { confirmationMail: null } },
      ]),
    );
    expect(await counts()).toEqual(ONLY_JONAS);
  });

  it("forks a deleting coach's live assignment for the player first (R-49)", async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedLink(db, 'c', 'p');
    const repertoireId = await seedRepertoire(db, 'c', NOW);
    expect(
      await assign(
        db,
        {
          coachId: 'c',
          repertoireId,
          target: { kind: 'player', playerId: 'p' },
          deadline: null,
        },
        NOW,
      ),
    ).toEqual(OK);
    expect(
      await deleteConfirmedAccount(db, {
        id: 'c',
        typed: 'Name c',
        now: LATER,
      }),
    ).toEqual({
      ok: true,
      value: { confirmationMail: { to: 'c@example.lt', locale: 'lt' } },
    });
    expect(await remaining()).toEqual([{ id: 'p' }]);
    expect(
      await query(
        `select name, owner_account_id, created_at from repertoires order by id`,
      ),
    ).toEqual([
      { name: 'Londono sistema', owner_account_id: 'p', created_at: LATER },
    ]);
  });
});
