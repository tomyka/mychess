import { createInvite, inviteTokenHash } from '@mychess/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createInviteAction,
  revokeInviteAction,
} from '../../src/app/treneris/actions';
import { TEST_ENV_VARS } from './support/auth';
import {
  actAs,
  coachPerson,
  formOf,
  groupOf,
  person,
} from './support/coaching';
import { useRequestHarness } from './support/harness';
import { outcomeOf, request, testDb } from './support/request';

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
        revokeInviteAction(formOf({ inviteId: mine.value.inviteId })),
      ),
    ).toBeUndefined();
    await outcomeOf(
      revokeInviteAction(formOf({ inviteId: onas.value.inviteId })),
    );
    await outcomeOf(revokeInviteAction(formOf({ inviteId: 'not-a-uuid' })));
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
});
