import { createInvite, inviteTokenHash } from '@mychess/db';
import { OPEN_INVITE_LIMIT } from '@mychess/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { acceptInviteAction } from '../../src/app/k/[token]/actions';
import InvitePage from '../../src/app/k/[token]/page';
import {
  createInviteAction,
  revokeInviteAction,
} from '../../src/app/treneris/actions';
import { coachGroupData } from '../../src/server/coach-pages';
import { cookieFrom, onboard, TEST_ENV_VARS } from './support/auth';
import {
  actAs,
  coachPerson,
  formOf,
  groupOf,
  person,
} from './support/coaching';
import { rebuildAuth, signIn, useRequestHarness } from './support/harness';
import { fakeProviderFetch, oauthRoundTrip } from './support/oauth';
import { built, outcomeOf, request, testDb } from './support/request';

vi.mock('next/headers', async () =>
  (await import('./support/request')).nextHeaders(),
);
vi.mock('next/navigation', async () =>
  (await import('./support/request')).nextNavigation(),
);
vi.mock('next/cache', async () =>
  (await import('./support/request')).nextCache(),
);
vi.mock('../../src/server/db', async () =>
  (await import('./support/request')).serverDb(),
);
vi.mock('../../src/server/auth', async (original) =>
  (await import('./support/request')).serverAuth(original),
);

const { sql } = useRequestHarness();

// The invite link is built from BETTER_AUTH_URL, read from the environment.
beforeEach(() => {
  for (const [name, value] of Object.entries(TEST_ENV_VARS))
    vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const LINK = /^http:\/\/localhost:3000\/k\/([A-Za-z0-9_-]{43})$/u;

const linkState = z.object({ link: z.string().regex(LINK) });

/** The token in a link the action answered with. */
function tokenOf(state: unknown): string {
  const token = LINK.exec(linkState.parse(state).link)?.[1];
  if (token === undefined) throw new Error('no token in the link');
  return token;
}

const storedInvites = (): Promise<unknown[]> =>
  sql.rows(
    `select i.kind, g.name as group, i.token_hash as "tokenHash",
            i.revoked_at is not null as revoked
       from invites i left join groups g on g.id = i.group_id
      order by i.created_at`,
  );

describe('createInviteAction (R-98, R-99, R-110)', () => {
  it('makes a personal invite and shows its link once; only the token’s hash is stored', async () => {
    actAs(await coachPerson(sql, 'jonas@example.lt', 'Jonas'));
    const state = await outcomeOf(
      createInviteAction({}, formOf({ kind: 'personal', groupId: '' })),
    );
    const token = tokenOf(state);
    expect(await storedInvites()).toEqual([
      {
        kind: 'personal',
        group: null,
        tokenHash: inviteTokenHash(token),
        revoked: false,
      },
    ]);
    expect(
      JSON.stringify(await sql.rows('select * from invites')),
    ).not.toContain(token);
    expect(request.refreshed).toBe(1);
  });

  it('makes a group invite for the coach’s own group', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    actAs(jonas);
    const token = tokenOf(
      await outcomeOf(
        createInviteAction({}, formOf({ kind: 'group', groupId })),
      ),
    );
    expect(await storedInvites()).toEqual([
      {
        kind: 'group',
        group: 'Šeštadienio grupė',
        tokenHash: inviteTokenHash(token),
        revoked: false,
      },
    ]);
  });

  it('refuses a group invite without a group', async () => {
    actAs(await coachPerson(sql, 'jonas@example.lt', 'Jonas'));
    expect(
      await outcomeOf(
        createInviteAction({}, formOf({ kind: 'group', groupId: '' })),
      ),
    ).toEqual({ refusal: 'invite.groupRequired' });
    expect(
      await outcomeOf(createInviteAction({}, formOf({ kind: 'group' }))),
    ).toEqual({ refusal: 'invite.groupRequired' });
    expect(await sql.count('invites')).toBe(0);
  });

  it('refuses an unknown kind and a malformed group id', async () => {
    actAs(await coachPerson(sql, 'jonas@example.lt', 'Jonas'));
    expect(
      await outcomeOf(createInviteAction({}, formOf({ kind: 'club' }))),
    ).toEqual({ refusal: 'invite.kindInvalid' });
    expect(
      await outcomeOf(
        createInviteAction({}, formOf({ kind: 'personal', groupId: 'x' })),
      ),
    ).toEqual({ refusal: 'invite.groupInvalid' });
    expect(await sql.count('invites')).toBe(0);
  });

  it('refuses another coach’s group', async () => {
    const ona = await coachPerson(sql, 'ona@example.lt', 'Ona');
    const onas = await groupOf(ona.id, 'Onos grupė');
    actAs(await coachPerson(sql, 'jonas@example.lt', 'Jonas'));
    expect(
      await outcomeOf(
        createInviteAction({}, formOf({ kind: 'group', groupId: onas })),
      ),
    ).toEqual({ refusal: 'coach.groupNotFound' });
    expect(await sql.count('invites')).toBe(0);
  });

  it('makes the invite for the session account, never a coachId the form carries (checklist 4)', async () => {
    const ona = await coachPerson(sql, 'ona@example.lt', 'Ona');
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    actAs(jonas);
    await outcomeOf(
      createInviteAction({}, formOf({ kind: 'personal', coachId: ona.id })),
    );
    expect(await sql.rows('select coach_id as "coachId" from invites')).toEqual(
      [{ coachId: jonas.id }],
    );
  });

  it('refuses a 51st open invite and makes nothing (R-114)', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const now = new Date();
    for (let made = 0; made < OPEN_INVITE_LIMIT; made += 1) {
      const invite = await createInvite(testDb(), {
        coachId: jonas.id,
        kind: 'personal',
        groupId: null,
        now,
      });
      if (!invite.ok) throw new Error(invite.refusal.reason);
    }
    actAs(jonas);
    expect(
      await outcomeOf(createInviteAction({}, formOf({ kind: 'personal' }))),
    ).toEqual({ refusal: 'coach.inviteLimit' });
    expect(await sql.count('invites')).toBe(OPEN_INVITE_LIMIT);
    expect(request.refreshed).toBe(0);
  });

  it('sends an account without Coach mode to settings', async () => {
    actAs(await person(sql, 'rokas@example.lt', 'Rokas'));
    expect(
      await outcomeOf(createInviteAction({}, formOf({ kind: 'personal' }))),
    ).toEqual({ redirectedTo: '/nustatymai' });
    expect(await sql.count('invites')).toBe(0);
  });
});

describe('revokeInviteAction (R-98)', () => {
  it('revokes the coach’s own invite and leaves another coach’s alone', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const ona = await coachPerson(sql, 'ona@example.lt', 'Ona');
    const now = new Date();
    const mine = await createInvite(testDb(), {
      coachId: jonas.id,
      kind: 'personal',
      groupId: null,
      now,
    });
    const onas = await createInvite(testDb(), {
      coachId: ona.id,
      kind: 'personal',
      groupId: null,
      now,
    });
    if (!mine.ok || !onas.ok) throw new Error('no invites');
    actAs(jonas);
    expect(
      await outcomeOf(
        revokeInviteAction({}, formOf({ inviteId: mine.value.inviteId })),
      ),
    ).toEqual({});
    expect(
      await outcomeOf(
        revokeInviteAction({}, formOf({ inviteId: onas.value.inviteId })),
      ),
    ).toEqual({ refusal: 'invite.invalid' });
    expect(
      await outcomeOf(
        revokeInviteAction({}, formOf({ inviteId: 'not-a-uuid' })),
      ),
    ).toEqual({ refusal: 'invite.invalid' });
    expect(
      await sql.rows(
        `select a.display_name as coach, i.revoked_at is not null as revoked
           from invites i join accounts a on a.id = i.coach_id
          order by 1`,
      ),
    ).toEqual([
      { coach: 'Jonas', revoked: true },
      { coach: 'Ona', revoked: false },
    ]);
    expect(request.refreshed).toBe(3);
  });

  it('refuses to revoke a used invite and leaves it used', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const made = await createInvite(testDb(), {
      coachId: jonas.id,
      kind: 'personal',
      groupId: null,
      now: new Date(),
    });
    if (!made.ok) throw new Error('no invite');
    actAs(rokas);
    expect(
      await outcomeOf(
        acceptInviteAction({}, formOf({ token: made.value.token })),
      ),
    ).toEqual({ redirectedTo: '/nustatymai#treneriai' });
    actAs(jonas);
    expect(
      await outcomeOf(
        revokeInviteAction({}, formOf({ inviteId: made.value.inviteId })),
      ),
    ).toEqual({ refusal: 'invite.invalid' });
    expect(
      await sql.rows('select used_by, revoked_at is null as open from invites'),
    ).toEqual([{ used_by: rokas.id, open: true }]);
  });
});

// The player half (Task A14): the invite page and accepting.

/** A fresh invite of `coachId`; its raw token. */
async function inviteOf(
  coachId: string,
  kind: 'personal' | 'group',
  groupId: string | null = null,
): Promise<string> {
  const made = await createInvite(testDb(), {
    coachId,
    kind,
    groupId,
    now: new Date(),
  });
  if (!made.ok) throw new Error(`no invite: ${made.refusal.reason}`);
  return made.value.token;
}

const invitePage = (token: string): Promise<unknown> =>
  outcomeOf(InvitePage({ params: Promise.resolve({ token }) }));

/** What the page hands its view: the preview of accepting. */
const previewOf = (page: unknown): unknown =>
  z.object({ props: z.object({ preview: z.unknown() }) }).parse(page).props
    .preview;

const accept = (fields: Readonly<Record<string, string>>): Promise<unknown> =>
  outcomeOf(acceptInviteAction({}, formOf(fields)));

const links = (): Promise<unknown[]> =>
  sql.rows(
    `select c.display_name as coach, p.display_name as player
       from coach_links l
       join accounts c on c.id = l.coach_id
       join accounts p on p.id = l.player_id
      order by 1, 2`,
  );

const memberships = (): Promise<unknown[]> =>
  sql.rows(
    `select g.name as group, p.display_name as player
       from group_members m
       join groups g on g.id = m.group_id
       join accounts p on p.id = m.player_id
      order by 1, 2`,
  );

const MY_COACHES = '/nustatymai#treneriai';
const WELL_FORMED = 'B'.repeat(43);

describe('the invite page /k/[token] (R-81, plan decision 8)', () => {
  it('sends a signed-out visitor to sign-in, and back to the invite after', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const token = await inviteOf(jonas.id, 'personal');
    request.cookie = '';
    expect(await invitePage(token)).toEqual({
      redirectedTo: `/prisijungti?next=%2Fk%2F${token}`,
    });
  });

  it('sends a signed-in account through onboarding, and back to the invite after', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const token = await inviteOf(jonas.id, 'personal');
    request.cookie = await signIn('rokas@example.lt');
    expect(await invitePage(token)).toEqual({
      redirectedTo: `/pradzia?next=%2Fk%2F${token}`,
    });
  });

  it('carries no return path for a malformed token', async () => {
    expect(await invitePage('not-a-token')).toEqual({
      redirectedTo: '/prisijungti',
    });
    expect(await invitePage(`${WELL_FORMED}?x=//evil.example`)).toEqual({
      redirectedTo: '/prisijungti',
    });
  });

  it('shows the coach and the group, and never accepts on a GET', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    const token = await inviteOf(jonas.id, 'group', groupId);
    actAs(await person(sql, 'rokas@example.lt', 'Rokas'));
    expect(previewOf(await invitePage(token))).toEqual({
      ok: true,
      value: {
        coachDisplayName: 'Jonas',
        groupName: 'Šeštadienio grupė',
        kind: 'group',
      },
    });
    expect(await sql.count('coach_links')).toBe(0);
    expect(await sql.count('group_members')).toBe(0);
  });

  it('says only "not valid" for a malformed or unknown token', async () => {
    actAs(await person(sql, 'rokas@example.lt', 'Rokas'));
    const invalid = { ok: false, refusal: { reason: 'invite.invalid' } };
    expect(previewOf(await invitePage('short'))).toEqual(invalid);
    expect(previewOf(await invitePage(WELL_FORMED))).toEqual(invalid);
  });
});

describe('acceptInviteAction (R-12, R-98, checklist 4 and 5)', () => {
  it('links the player into the group and lands on "Mano treneriai"', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    const token = await inviteOf(jonas.id, 'group', groupId);
    actAs(await person(sql, 'rokas@example.lt', 'Rokas'));
    expect(await accept({ token })).toEqual({ redirectedTo: MY_COACHES });
    expect(await links()).toEqual([{ coach: 'Jonas', player: 'Rokas' }]);
    expect(await memberships()).toEqual([
      { group: 'Šeštadienio grupė', player: 'Rokas' },
    ]);
  });

  it('refuses a malformed, unknown, expired, revoked or used token alike, and links nobody', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const expired = await inviteOf(jonas.id, 'personal');
    await sql.rows(
      `update invites set expires_at = now() - interval '1 minute'
        where token_hash = $1`,
      [inviteTokenHash(expired)],
    );
    const revoked = await inviteOf(jonas.id, 'personal');
    await sql.rows(
      'update invites set revoked_at = now() where token_hash = $1',
      [inviteTokenHash(revoked)],
    );
    const used = await inviteOf(jonas.id, 'personal');
    actAs(await person(sql, 'gabija@example.lt', 'Gabija'));
    expect(await accept({ token: used })).toEqual({
      redirectedTo: MY_COACHES,
    });
    actAs(await person(sql, 'rokas@example.lt', 'Rokas'));
    const invalid = { refusal: 'invite.invalid' };
    for (const token of ['short', WELL_FORMED, expired, revoked, used])
      expect(await accept({ token })).toEqual(invalid);
    expect(await accept({})).toEqual(invalid);
    expect(await links()).toEqual([{ coach: 'Jonas', player: 'Gabija' }]);
  });

  it('refuses an invite of a disabled coach as "not valid" (R-108)', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const token = await inviteOf(jonas.id, 'personal');
    await sql.rows('update accounts set disabled_at = now() where id = $1', [
      jonas.id,
    ]);
    actAs(await person(sql, 'rokas@example.lt', 'Rokas'));
    expect(previewOf(await invitePage(token))).toEqual({
      ok: false,
      refusal: { reason: 'invite.invalid' },
    });
    expect(await accept({ token })).toEqual({ refusal: 'invite.invalid' });
    expect(await sql.count('coach_links')).toBe(0);
  });

  it('refuses the coach’s own invite', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const token = await inviteOf(jonas.id, 'personal');
    actAs(jonas);
    expect(await accept({ token })).toEqual({ refusal: 'invite.ownInvite' });
    expect(await sql.count('coach_links')).toBe(0);
  });

  it('links the session account, never a playerId the form carries (checklist 4)', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
    const token = await inviteOf(jonas.id, 'personal');
    actAs(await person(sql, 'rokas@example.lt', 'Rokas'));
    expect(await accept({ token, playerId: gabija.id })).toEqual({
      redirectedTo: MY_COACHES,
    });
    expect(await links()).toEqual([{ coach: 'Jonas', player: 'Rokas' }]);
  });

  it('sends a signed-out visitor to sign-in and links nobody', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const token = await inviteOf(jonas.id, 'personal');
    request.cookie = '';
    expect(await accept({ token })).toEqual({ redirectedTo: '/prisijungti' });
    expect(await sql.count('coach_links')).toBe(0);
  });

  it('links a player who signed in with Google, without a second account (G-M1-1)', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    const token = await inviteOf(jonas.id, 'group', groupId);
    const fetch = fakeProviderFetch({
      google: {
        sub: 'g-1',
        email: 'gabija@example.lt',
        email_verified: true,
        name: 'Gabija',
      },
    });
    vi.stubGlobal('fetch', fetch);
    rebuildAuth({ fetch });
    const cookie = cookieFrom(await oauthRoundTrip(built(), 'google'));
    await onboard(built(), testDb(), cookie, {
      displayName: 'Gabija',
      locale: 'lt',
    });
    request.cookie = cookie;
    expect(await accept({ token })).toEqual({ redirectedTo: MY_COACHES });
    expect(await sql.count(`accounts where email = 'gabija@example.lt'`)).toBe(
      1,
    );
    actAs(jonas);
    expect(await outcomeOf(coachGroupData(groupId))).toMatchObject({
      members: [{ displayName: 'Gabija' }],
    });
  });
});
