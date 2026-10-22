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

describe('the request counters schema', () => {
  const insertCounter = (key: string, windowStart: number) =>
    client.query(
      'insert into request_counters (key, count, window_start) values ($1, 1, $2)',
      [key, windowStart],
    );

  it('keeps one counter per key, with its window start in epoch milliseconds', async () => {
    const windowStart = Date.UTC(2026, 9, 16, 12, 0, 0, 123);
    await insertCounter('pgn-import:a1', windowStart);
    const { rows } = await client.query(
      'select key, count, window_start::text as window_start from request_counters',
    );
    expect(rows).toEqual([
      { key: 'pgn-import:a1', count: 1, window_start: String(windowStart) },
    ]);
  });

  it('refuses a second counter for the same key', async () => {
    await insertCounter('pgn-import:a1', 1);
    await expect(insertCounter('pgn-import:a1', 2)).rejects.toThrow(
      /unique|duplicate/,
    );
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

describe('the sharing tables', () => {
  const account = (id: string) =>
    client.query(
      `insert into accounts (id, email, display_name, created_at, updated_at)
       values ($1, $1 || '@example.lt', $1, now(), now())`,
      [id],
    );
  const link = (coachId: string, playerId: string) =>
    client.query(
      `insert into coach_links (coach_id, player_id, created_at) values ($1, $2, now())`,
      [coachId, playerId],
    );
  const repertoire = async (owner: string): Promise<string> => {
    const { rows } = await client.query<{ id: string }>(
      `insert into repertoires (owner_account_id, side, name, created_at, updated_at)
       values ($1, 'black', 'Taimanov', now(), now()) returning id`,
      [owner],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('no repertoire id');
    return id;
  };
  const share = (rep: string, playerId: string, coachId: string) =>
    client.query(
      `insert into repertoire_shares (repertoire_id, player_id, coach_id, created_at)
       values ($1, $2, $3, now())`,
      [rep, playerId, coachId],
    );
  const note = (coachId: string, rep: string, text = 'Žiūrėk į d5') =>
    client.query(
      `insert into coach_notes (coach_id, repertoire_id, move_key, text, created_at, updated_at)
       values ($1, $2, 'start|e4', $3, now(), now())`,
      [coachId, rep, text],
    );
  const counts = async (): Promise<unknown> =>
    (
      await client.query(`select
        (select count(*) from repertoire_shares)::int as shares,
        (select count(*) from coach_notes)::int as notes`)
    ).rows[0];

  beforeEach(async () => {
    for (const id of ['coach', 'coach2', 'gabija', 'rokas']) await account(id);
    await link('coach', 'gabija');
    await link('coach', 'rokas');
    await link('coach2', 'gabija');
  });

  it('shares a repertoire once per coach', async () => {
    const rep = await repertoire('gabija');
    await share(rep, 'gabija', 'coach');
    await expect(share(rep, 'gabija', 'coach')).rejects.toThrow(
      /repertoire_shares_pk/,
    );
  });

  it('refuses a share with a coach who is not linked to the owner', async () => {
    const rep = await repertoire('rokas');
    await expect(share(rep, 'rokas', 'coach2')).rejects.toThrow(
      /repertoire_shares_link_fk/,
    );
  });

  it('refuses a share naming a player who does not own the repertoire', async () => {
    const rep = await repertoire('rokas');
    await expect(share(rep, 'gabija', 'coach')).rejects.toThrow(
      /repertoire_shares_owner_fk/,
    );
  });

  it("ends that coach's shares of that player only when the link ends", async () => {
    const taimanov = await repertoire('gabija');
    const london = await repertoire('rokas');
    await share(taimanov, 'gabija', 'coach');
    await share(taimanov, 'gabija', 'coach2');
    await share(london, 'rokas', 'coach');
    await client.query(
      `delete from coach_links where coach_id = 'coach' and player_id = 'gabija'`,
    );
    const { rows } = await client.query(
      'select repertoire_id, coach_id from repertoire_shares order by coach_id',
    );
    expect(rows).toEqual([
      { repertoire_id: london, coach_id: 'coach' },
      { repertoire_id: taimanov, coach_id: 'coach2' },
    ]);
  });

  it('removes the shares and coach notes with the repertoire', async () => {
    const rep = await repertoire('gabija');
    await share(rep, 'gabija', 'coach');
    await note('coach', rep);
    await client.query('delete from repertoires where id = $1', [rep]);
    expect(await counts()).toEqual({ shares: 0, notes: 0 });
  });

  it("removes a coach's shares and notes with the coach's account", async () => {
    const rep = await repertoire('gabija');
    await share(rep, 'gabija', 'coach');
    await share(rep, 'gabija', 'coach2');
    await note('coach', rep);
    await note('coach2', rep);
    await client.query(`delete from accounts where id = 'coach'`);
    const { rows } = await client.query(`select
      (select array_agg(coach_id) from repertoire_shares) as shares,
      (select array_agg(coach_id) from coach_notes) as notes`);
    expect(rows).toEqual([{ shares: ['coach2'], notes: ['coach2'] }]);
  });

  it("removes the shares and notes with the owner's account", async () => {
    const rep = await repertoire('gabija');
    await share(rep, 'gabija', 'coach');
    await note('coach', rep);
    await client.query(`delete from accounts where id = 'gabija'`);
    expect(await counts()).toEqual({ shares: 0, notes: 0 });
  });

  it('keeps one note per coach and move', async () => {
    const rep = await repertoire('gabija');
    await share(rep, 'gabija', 'coach');
    await share(rep, 'gabija', 'coach2');
    await note('coach', rep);
    await note('coach2', rep);
    await expect(note('coach', rep)).rejects.toThrow(
      /coach_notes_coach_move_unique/,
    );
  });

  it.each([
    ['blank', '   '],
    ['empty', ''],
    ['untrimmed', ' d5 '],
    ['too long', 'a'.repeat(2001)],
  ])('refuses a note text that is %s', async (_, text) => {
    const rep = await repertoire('gabija');
    await share(rep, 'gabija', 'coach');
    await expect(note('coach', rep, text)).rejects.toThrow(
      /coach_notes_text_check/,
    );
  });

  it('accepts a note of 2000 characters', async () => {
    const rep = await repertoire('gabija');
    await share(rep, 'gabija', 'coach');
    await note('coach', rep, 'a'.repeat(2000));
    expect(await counts()).toEqual({ shares: 1, notes: 1 });
  });

  it('refuses a note on a repertoire not shared with its coach (R-124)', async () => {
    const rep = await repertoire('gabija');
    await share(rep, 'gabija', 'coach2');
    await expect(note('coach', rep)).rejects.toThrow(/coach_notes_share_fk/);
  });

  it("removes a coach's notes on a repertoire when that share ends (R-124)", async () => {
    const taimanov = await repertoire('gabija');
    const other = await repertoire('gabija');
    await share(taimanov, 'gabija', 'coach');
    await share(taimanov, 'gabija', 'coach2');
    await share(other, 'gabija', 'coach');
    await note('coach', taimanov);
    await note('coach2', taimanov);
    await note('coach', other);
    await client.query(
      `delete from repertoire_shares where repertoire_id = $1 and coach_id = 'coach'`,
      [taimanov],
    );
    const { rows } = await client.query(
      'select repertoire_id, coach_id from coach_notes order by coach_id',
    );
    expect(rows).toEqual([
      { repertoire_id: other, coach_id: 'coach' },
      { repertoire_id: taimanov, coach_id: 'coach2' },
    ]);
  });

  it("removes a coach's notes on all of that player's repertoires on unlink (R-124)", async () => {
    const taimanov = await repertoire('gabija');
    const london = await repertoire('gabija');
    const rokas = await repertoire('rokas');
    for (const rep of [taimanov, london]) {
      await share(rep, 'gabija', 'coach');
      await share(rep, 'gabija', 'coach2');
      await note('coach', rep);
      await note('coach2', rep);
    }
    await share(rokas, 'rokas', 'coach');
    await note('coach', rokas);
    await client.query(
      `delete from coach_links where coach_id = 'coach' and player_id = 'gabija'`,
    );
    const { rows } = await client.query(
      'select repertoire_id, coach_id from coach_notes order by coach_id, repertoire_id',
    );
    expect(rows).toEqual([
      { repertoire_id: rokas, coach_id: 'coach' },
      ...[taimanov, london]
        .sort()
        .map((id) => ({ repertoire_id: id, coach_id: 'coach2' })),
    ]);
  });

  it('indexes the cascades: shares by link, notes by repertoire', async () => {
    const { rows } = await client.query<{ table: string; leading: string }>(
      `select t.relname as table, a.attname as leading
       from pg_index i
       join pg_class t on t.oid = i.indrelid
       join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
       where t.relname in ('repertoire_shares', 'coach_notes')`,
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { table: 'repertoire_shares', leading: 'coach_id' },
        { table: 'repertoire_shares', leading: 'repertoire_id' },
        { table: 'coach_notes', leading: 'coach_id' },
        { table: 'coach_notes', leading: 'repertoire_id' },
      ]),
    );
  });
});

describe('the assignment tables', () => {
  const account = (id: string) =>
    client.query(
      `insert into accounts (id, email, display_name, created_at, updated_at)
       values ($1, $1 || '@example.lt', $1, now(), now())`,
      [id],
    );
  const link = (coachId: string, playerId: string) =>
    client.query(
      `insert into coach_links (coach_id, player_id, created_at) values ($1, $2, now())`,
      [coachId, playerId],
    );
  const returningId = async (
    text: string,
    values: readonly unknown[],
  ): Promise<string> => {
    const { rows } = await client.query<{ id: string }>(text, [...values]);
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('no id');
    return id;
  };
  const repertoire = (owner: string) =>
    returningId(
      `insert into repertoires (owner_account_id, side, name, created_at, updated_at)
       values ($1, 'black', 'Karo-Kan gynyba', now(), now()) returning id`,
      [owner],
    );
  const group = (coachId: string) =>
    returningId(
      `insert into groups (coach_id, name, created_at) values ($1, 'Šeštadienio grupė', now()) returning id`,
      [coachId],
    );
  const assign = (
    coachId: string,
    rep: string,
    target: { player?: string; group?: string },
  ) =>
    client.query(
      `insert into assignments (coach_id, repertoire_id, player_id, group_id, assigned_version, created_at)
       values ($1, $2, $3, $4, 1, now())`,
      [coachId, rep, target.player ?? null, target.group ?? null],
    );
  const offer = (rep: string, forkId: string | null = null) =>
    client.query(
      `insert into fork_offers (player_id, repertoire_id, coach_name, name, side, snapshot, reason, created_at, expires_at, fork_id)
       values ('p', $1, 'Treneris', 'Karo-Kan gynyba', 'black', '{}', 'unassigned', now(), now() + interval '30 days', $2)`,
      [rep, forkId],
    );
  const count = async (table: string): Promise<number> => {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from ${table}`,
    );
    return rows[0]?.n ?? -1;
  };

  let rep = '';
  let g = '';
  let h = '';

  beforeEach(async () => {
    for (const id of ['c', 'd', 'p', 'u']) await account(id);
    await link('c', 'p');
    rep = await repertoire('c');
    g = await group('c');
    h = await group('d');
    await client.query(
      `insert into group_members (group_id, coach_id, player_id, joined_at) values ($1, 'c', 'p', now())`,
      [g],
    );
  });

  it('refuses an assignment to both a player and a group', async () => {
    await expect(assign('c', rep, { player: 'p', group: g })).rejects.toThrow(
      /assignments_one_target/,
    );
  });

  it('refuses an assignment to neither a player nor a group', async () => {
    await expect(assign('c', rep, {})).rejects.toThrow(
      /assignments_one_target/,
    );
  });

  it("refuses an assignment of another coach's repertoire", async () => {
    await link('d', 'p');
    await expect(assign('d', rep, { player: 'p' })).rejects.toThrow(
      /assignments_repertoire_fk/,
    );
  });

  it('refuses an assignment to a player who is not linked', async () => {
    await expect(assign('c', rep, { player: 'u' })).rejects.toThrow(
      /assignments_link_fk/,
    );
  });

  it("refuses an assignment to another coach's group", async () => {
    await expect(assign('c', rep, { group: h })).rejects.toThrow(
      /assignments_group_fk/,
    );
  });

  it('assigns a repertoire to a player and to a group at most once each', async () => {
    await assign('c', rep, { player: 'p' });
    await assign('c', rep, { group: g });
    await expect(assign('c', rep, { player: 'p' })).rejects.toThrow(
      /assignments_player_unique/,
    );
    await expect(assign('c', rep, { group: g })).rejects.toThrow(
      /assignments_group_unique/,
    );
  });

  it('ends the player assignment, and only it, when the link ends', async () => {
    await assign('c', rep, { player: 'p' });
    await assign('c', rep, { group: g });
    await client.query(
      `delete from coach_links where coach_id = 'c' and player_id = 'p'`,
    );
    const { rows } = await client.query(
      'select player_id, group_id from assignments',
    );
    expect(rows).toEqual([{ player_id: null, group_id: g }]);
  });

  it('ends the group assignment, and only it, with the group', async () => {
    await assign('c', rep, { player: 'p' });
    await assign('c', rep, { group: g });
    await client.query('delete from groups where id = $1', [g]);
    const { rows } = await client.query(
      'select player_id, group_id from assignments',
    );
    expect(rows).toEqual([{ player_id: 'p', group_id: null }]);
  });

  it('removes assignments, changes and player state with the repertoire, and keeps the fork offer', async () => {
    await assign('c', rep, { player: 'p' });
    await assign('c', rep, { group: g });
    await client.query(
      `insert into repertoire_changes (repertoire_id, version, changes, created_at)
       values ($1, 2, '{"added":[],"removed":[]}', now())`,
      [rep],
    );
    await client.query(
      `insert into assignment_players (player_id, repertoire_id, paused_at) values ('p', $1, now())`,
      [rep],
    );
    await offer(rep);
    await client.query('delete from repertoires where id = $1', [rep]);
    expect(await count('assignments')).toBe(0);
    expect(await count('repertoire_changes')).toBe(0);
    expect(await count('assignment_players')).toBe(0);
    const { rows } = await client.query(
      'select player_id, repertoire_id from fork_offers',
    );
    expect(rows).toEqual([{ player_id: 'p', repertoire_id: null }]);
  });

  it('keeps an accepted fork offer when the fork is deleted, without the fork', async () => {
    const fork = await repertoire('p');
    await offer(rep, fork);
    await client.query('delete from repertoires where id = $1', [fork]);
    const { rows } = await client.query(
      'select repertoire_id, fork_id from fork_offers',
    );
    expect(rows).toEqual([{ repertoire_id: rep, fork_id: null }]);
  });

  it('refuses a fork offer with an unknown reason', async () => {
    await expect(
      client.query(
        `insert into fork_offers (player_id, coach_name, name, side, snapshot, reason, created_at, expires_at)
         values ('p', 'Treneris', 'x', 'black', '{}', 'expired', now(), now())`,
      ),
    ).rejects.toThrow(/fork_offers_reason_check/);
  });

  it("removes a fork's coach notes with the fork", async () => {
    const fork = await repertoire('p');
    await client.query(
      `insert into fork_coach_notes (repertoire_id, move_key, text, coach_name)
       values ($1, 'start|e4', 'Žiūrėk į d5', 'Treneris')`,
      [fork],
    );
    await client.query('delete from repertoires where id = $1', [fork]);
    expect(await count('fork_coach_notes')).toBe(0);
  });

  it('indexes the cascades of the assignment tables', async () => {
    const { rows } = await client.query<{ table: string; leading: string }>(
      `select t.relname as table, a.attname as leading
       from pg_index i
       join pg_class t on t.oid = i.indrelid
       join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
       where i.indpred is null
         and t.relname in ('assignments', 'assignment_players', 'repertoire_changes', 'fork_offers', 'fork_coach_notes')`,
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { table: 'assignments', leading: 'repertoire_id' },
        { table: 'assignments', leading: 'coach_id' },
        { table: 'assignments', leading: 'group_id' },
        { table: 'assignment_players', leading: 'player_id' },
        { table: 'assignment_players', leading: 'repertoire_id' },
        { table: 'repertoire_changes', leading: 'repertoire_id' },
        { table: 'fork_offers', leading: 'player_id' },
        { table: 'fork_offers', leading: 'repertoire_id' },
        { table: 'fork_offers', leading: 'fork_id' },
        { table: 'fork_coach_notes', leading: 'repertoire_id' },
      ]),
    );
  });
});
