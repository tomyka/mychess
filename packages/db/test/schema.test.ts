import { beforeEach, describe, expect, it } from 'vitest';
import { auditEmailHash } from '../src';
import { TEST_AUDIT_EMAIL_KEY, useTestDatabase } from '../src/testing';

const { client } = useTestDatabase();

const insertAccount = (id: string, email: string) =>
  client.query(
    `insert into accounts (id, email, display_name, created_at, updated_at)
     values ($1, $2, '', now(), now())`,
    [id, email],
  );

const RUTA_HASH = auditEmailHash('ruta@example.lt', TEST_AUDIT_EMAIL_KEY);

const insertAudit = (action: string, hash: string) =>
  client.query(
    `insert into admin_audit (action, target_account_id, target_email_hash, actor, at)
     values ($1, 'a1', $2, 'cli', now())`,
    [action, hash],
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
    await expect(insertAudit('delete-everything', RUTA_HASH)).rejects.toThrow(
      /admin_audit_action_check/,
    );
  });

  it.each([
    ['the plain address', 'ruta@example.lt'],
    ['an upper-case hash', RUTA_HASH.toUpperCase()],
    ['a short hash', RUTA_HASH.slice(1)],
    [
      'a hash with a trailing newline',
      `${RUTA_HASH}
`,
    ],
  ])(
    'refuses an audit row holding %s instead of the hash (R-88)',
    async (_, hash) => {
      await expect(insertAudit('grant-admin', hash)).rejects.toThrow(
        /admin_audit_target_email_hash_check/,
      );
    },
  );

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
    await insertAudit('grant-admin', RUTA_HASH);
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

describe('the coaching schema', () => {
  const HASH_A = 'a'.repeat(64);
  const HASH_B = 'b'.repeat(64);

  const link = (coachId: string, playerId: string) =>
    client.query(
      `insert into coach_links (coach_id, player_id, created_at) values ($1, $2, now())`,
      [coachId, playerId],
    );

  const group = async (coachId: string, name: string): Promise<string> => {
    const { rows } = await client.query<{ id: string }>(
      `insert into groups (coach_id, name, created_at) values ($1, $2, now()) returning id`,
      [coachId, name],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('no group id');
    return id;
  };

  const member = (groupId: string, coachId: string, playerId: string) =>
    client.query(
      `insert into group_members (group_id, coach_id, player_id, joined_at) values ($1, $2, $3, now())`,
      [groupId, coachId, playerId],
    );

  const invite = (
    over: { kind?: string; groupId?: string | null; hash?: string } = {},
  ) =>
    client.query(
      `insert into invites (coach_id, kind, group_id, token_hash, expires_at, created_at)
       values ('c', $1, $2, $3, now(), now())`,
      [over.kind ?? 'personal', over.groupId ?? null, over.hash ?? HASH_A],
    );

  const count = async (table: string): Promise<number> => {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from ${table}`,
    );
    return rows[0]?.n ?? -1;
  };

  beforeEach(async () => {
    await insertAccount('c', 'coach@example.lt');
    await insertAccount('c2', 'coach2@example.lt');
    await insertAccount('p1', 'p1@example.lt');
    await insertAccount('p2', 'p2@example.lt');
  });

  it('starts every account with Coach mode off', async () => {
    const { rows } = await client.query(
      `select coach_since from accounts where id = 'c'`,
    );
    expect(rows).toEqual([{ coach_since: null }]);
  });

  it('refuses a coach linking to themselves', async () => {
    await expect(link('c', 'c')).rejects.toThrow(/coach_links_not_self/);
  });

  it('refuses a second link for the same pair', async () => {
    await link('c', 'p1');
    await expect(link('c', 'p1')).rejects.toThrow(/duplicate key/);
  });

  it('refuses a group invite without a group (R-110)', async () => {
    await expect(invite({ kind: 'group' })).rejects.toThrow(
      /invites_group_kind/,
    );
  });

  it('refuses an invite kind that does not exist', async () => {
    await expect(invite({ kind: 'public' })).rejects.toThrow(
      /invites_kind_check/,
    );
  });

  it.each([
    ['not hex', 'not-hex'],
    ['upper case', 'A'.repeat(64)],
    ['too short', 'a'.repeat(63)],
  ])('refuses a token hash that is %s', async (_, hash) => {
    await expect(invite({ hash })).rejects.toThrow(/invites_token_hash_check/);
  });

  it('refuses two invites with the same token hash', async () => {
    await invite();
    await expect(invite()).rejects.toThrow(/duplicate key/);
  });

  it('refuses a used group invite', async () => {
    const groupId = await group('c', 'Šeštadienio grupė');
    await invite({ kind: 'group', groupId });
    await expect(
      client.query(`update invites set used_at = now()`),
    ).rejects.toThrow(/invites_used_personal/);
  });

  it("refuses an invite naming another coach's group", async () => {
    const groupId = await group('c2', 'Kita');
    await expect(invite({ kind: 'group', groupId })).rejects.toThrow(
      /invites_group_fk/,
    );
  });

  it.each([
    ['blank', '   '],
    ['empty', ''],
    ['untrimmed', ' Grupė'],
    ['too long', 'g'.repeat(61)],
  ])('refuses a %s group name', async (_, name) => {
    await expect(group('c', name)).rejects.toThrow(/groups_name_check/);
  });

  it('accepts a group name of 60 characters', async () => {
    await group('c', 'g'.repeat(60));
    expect(await count('groups')).toBe(1);
  });

  it('refuses a member who is not linked to the coach', async () => {
    const groupId = await group('c', 'Šeštadienio grupė');
    await expect(member(groupId, 'c', 'p2')).rejects.toThrow(
      /group_members_link_fk/,
    );
  });

  it("refuses a member put into another coach's group", async () => {
    await link('c', 'p1');
    const foreign = await group('c2', 'Kita');
    await expect(member(foreign, 'c', 'p1')).rejects.toThrow(
      /group_members_group_fk/,
    );
  });

  it("removes the player from that coach's groups only when the link ends", async () => {
    await link('c', 'p1');
    await link('c2', 'p1');
    await member(await group('c', 'Mano'), 'c', 'p1');
    await member(await group('c2', 'Kita'), 'c2', 'p1');
    await client.query(
      `delete from coach_links where coach_id = 'c' and player_id = 'p1'`,
    );
    const { rows } = await client.query(
      'select coach_id, player_id from group_members',
    );
    expect(rows).toEqual([{ coach_id: 'c2', player_id: 'p1' }]);
  });

  it('removes a group with its members and invites', async () => {
    await link('c', 'p1');
    const groupId = await group('c', 'Mano');
    await member(groupId, 'c', 'p1');
    await invite({ kind: 'group', groupId });
    await invite({ kind: 'personal', groupId, hash: HASH_B });
    await client.query('delete from groups');
    expect(await count('group_members')).toBe(0);
    expect(await count('invites')).toBe(0);
    expect(await count('coach_links')).toBe(1);
  });

  it("removes a coach's links, groups, members and invites with the account", async () => {
    await link('c', 'p1');
    await link('p2', 'c');
    const groupId = await group('c', 'Mano');
    await member(groupId, 'c', 'p1');
    await invite({ kind: 'group', groupId });
    await client.query(`delete from accounts where id = 'c'`);
    expect(await count('coach_links')).toBe(0);
    expect(await count('groups')).toBe(0);
    expect(await count('group_members')).toBe(0);
    expect(await count('invites')).toBe(0);
  });

  it('indexes the invites by their user, which deleting an account looks up', async () => {
    const { rows } = await client.query(
      `select indexdef from pg_indexes where tablename = 'invites' and indexname = 'invites_used_by_idx'`,
    );
    expect(rows).toEqual([
      {
        indexdef:
          'CREATE INDEX invites_used_by_idx ON public.invites USING btree (used_by)',
      },
    ]);
  });

  it('keeps a personal invite whose user is deleted, without the user', async () => {
    await invite();
    await client.query(`update invites set used_at = now(), used_by = 'p1'`);
    await client.query(`delete from accounts where id = 'p1'`);
    const { rows } = await client.query(
      'select used_by, used_at is not null as used from invites',
    );
    expect(rows).toEqual([{ used_by: null, used: true }]);
  });
});

describe('the repertoire tables', () => {
  const account = (id: string) =>
    client.query(
      `insert into accounts (id, email, display_name, created_at, updated_at)
       values ($1, $1 || '@example.lt', $1, now(), now())`,
      [id],
    );
  const repertoire = async (owner: string): Promise<string> =>
    (
      await client.query<{ id: string }>(
        `insert into repertoires (owner_account_id, side, name, created_at, updated_at)
         values ($1, 'white', 'London', now(), now()) returning id`,
        [owner],
      )
    ).rows[0]?.id ?? '';
  const chapter = (rep: string) =>
    client.query(
      `insert into chapters (repertoire_id, chapter_id, root_key, name_source, ord)
       values ($1, 'c1', 'start', '{"kind":"index","number":1}', 0)`,
      [rep],
    );
  const move = async (rep: string, san: string): Promise<string> =>
    (
      await client.query<{ id: string }>(
        `insert into repertoire_moves (repertoire_id, from_key, san, to_key, uci, ord)
         values ($1, 'start', $2, 'after', 'e2e4', 0) returning id`,
        [rep, san],
      )
    ).rows[0]?.id ?? '';

  it('starts a repertoire at version 1 and refuses an unknown side', async () => {
    await account('a1');
    const id = await repertoire('a1');
    expect(
      (
        await client.query('select version from repertoires where id = $1', [
          id,
        ])
      ).rows,
    ).toEqual([{ version: 1 }]);
    await expect(
      client.query(
        `insert into repertoires (owner_account_id, side, name, created_at, updated_at)
         values ('a1', 'red', 'x', now(), now())`,
      ),
    ).rejects.toThrow(/check/);
  });

  it('stores a move once per position and SAN in a repertoire', async () => {
    await account('a1');
    const rep = await repertoire('a1');
    await move(rep, 'e4');
    await expect(move(rep, 'e4')).rejects.toThrow(/unique/);
  });

  it('removes every repertoire row with the account (S1 hard delete)', async () => {
    await account('a1');
    const rep = await repertoire('a1');
    await chapter(rep);
    const moveId = await move(rep, 'e4');
    await client.query(
      `insert into move_chapters (move_id, repertoire_id, chapter_id) values ($1, $2, 'c1')`,
      [moveId, rep],
    );
    await client.query(
      `insert into personal_notes (player_account_id, repertoire_id, move_key, text, updated_at)
       values ('a1', $1, 'start|e4', 'note', now())`,
      [rep],
    );
    await client.query(`delete from accounts where id = 'a1'`);
    const { rows } = await client.query(`select
      (select count(*) from repertoires)::int as r, (select count(*) from chapters)::int as c,
      (select count(*) from repertoire_moves)::int as m, (select count(*) from move_chapters)::int as l,
      (select count(*) from personal_notes)::int as n`);
    expect(rows).toEqual([{ r: 0, c: 0, m: 0, l: 0, n: 0 }]);
  });

  it('removes a chapter link with its chapter, and keeps the move', async () => {
    await account('a1');
    const rep = await repertoire('a1');
    await chapter(rep);
    const moveId = await move(rep, 'e4');
    await client.query(
      `insert into move_chapters (move_id, repertoire_id, chapter_id) values ($1, $2, 'c1')`,
      [moveId, rep],
    );
    await client.query(`delete from chapters where repertoire_id = $1`, [rep]);
    const { rows } = await client.query(`select
      (select count(*) from move_chapters)::int as l, (select count(*) from repertoire_moves)::int as m`);
    expect(rows).toEqual([{ l: 0, m: 1 }]);
  });

  it("refuses a chapter link naming another repertoire than its move's", async () => {
    await account('a1');
    const rep = await repertoire('a1');
    const other = await repertoire('a1');
    await chapter(other);
    const moveId = await move(rep, 'e4');
    await expect(
      client.query(
        `insert into move_chapters (move_id, repertoire_id, chapter_id) values ($1, $2, 'c1')`,
        [moveId, other],
      ),
    ).rejects.toThrow(/move_chapters_move_fk/);
  });

  it('removes a chapter link with its move', async () => {
    await account('a1');
    const rep = await repertoire('a1');
    await chapter(rep);
    const moveId = await move(rep, 'e4');
    await client.query(
      `insert into move_chapters (move_id, repertoire_id, chapter_id) values ($1, $2, 'c1')`,
      [moveId, rep],
    );
    await client.query(`delete from repertoire_moves where id = $1`, [moveId]);
    const { rows } = await client.query(
      'select count(*)::int as l from move_chapters',
    );
    expect(rows).toEqual([{ l: 0 }]);
  });

  it('indexes personal notes by repertoire, so a repertoire delete does not scan them', async () => {
    const { rows } = await client.query<{ leading: string }>(
      `select a.attname as leading
       from pg_index i
       join pg_class t on t.oid = i.indrelid
       join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
       where t.relname = 'personal_notes'`,
    );
    expect(rows.map((r) => r.leading)).toContain('repertoire_id');
  });
});
