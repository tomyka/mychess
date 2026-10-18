import { createInvite } from '@mychess/db';
import { describe, expect, it, vi } from 'vitest';
import {
  startCoachingAction,
  stopCoachingAction,
} from '../../src/app/nustatymai/coaching-actions';
import { actAs, coachPerson, groupOf, link, person } from './support/coaching';
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

const coachModes = (): Promise<unknown[]> =>
  sql.rows(
    'select email, coach_since is not null as coach from accounts order by email',
  );

describe('startCoachingAction (R-11, R-13)', () => {
  it('switches Coach mode on for the session account only', async () => {
    await person(sql, 'rokas@example.lt', 'Rokas');
    const jonas = await person(sql, 'jonas@example.lt', 'Jonas');
    actAs(jonas);
    expect(await outcomeOf(startCoachingAction())).toBeUndefined();
    expect(await coachModes()).toEqual([
      { email: 'jonas@example.lt', coach: true },
      { email: 'rokas@example.lt', coach: false },
    ]);
    expect(request.refreshed).toBe(1);
  });

  it('sends a signed-out visitor to sign-in', async () => {
    expect(await outcomeOf(startCoachingAction())).toEqual({
      redirectedTo: '/prisijungti',
    });
  });
});

describe('stopCoachingAction (R-100, R-109)', () => {
  it('switches Coach mode off with no linked player, revoking the open invites and keeping the groups', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const groupId = await groupOf(jonas.id, 'Šeštadienio grupė');
    await createInvite(testDb(), {
      coachId: jonas.id,
      kind: 'group',
      groupId,
      now: new Date(),
    });
    actAs(jonas);
    expect(await outcomeOf(stopCoachingAction())).toEqual({});
    expect(await coachModes()).toEqual([
      { email: 'jonas@example.lt', coach: false },
    ]);
    expect(
      await sql.rows('select revoked_at is not null as revoked from invites'),
    ).toEqual([{ revoked: true }]);
    expect(await sql.count('groups')).toBe(1);
    expect(request.refreshed).toBe(1);
  });

  it('refuses while players are linked, lists them by name and stays on', async () => {
    const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
    await link(jonas.id, rokas.id);
    await link(jonas.id, gabija.id);
    actAs(jonas);
    expect(await outcomeOf(stopCoachingAction())).toEqual({
      refusal: 'coach.stillLinked',
      players: [
        { id: gabija.id, displayName: 'Gabija' },
        { id: rokas.id, displayName: 'Rokas' },
      ],
    });
    expect(
      await sql.rows(
        "select coach_since is not null as coach from accounts where email = 'jonas@example.lt'",
      ),
    ).toEqual([{ coach: true }]);
    expect(request.refreshed).toBe(0);
  });

  it('sends a signed-out visitor to sign-in', async () => {
    expect(await outcomeOf(stopCoachingAction())).toEqual({
      redirectedTo: '/prisijungti',
    });
  });
});
