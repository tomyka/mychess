import { describe, expect, it } from 'vitest';
import {
  INVITE_ISSUES,
  INVITE_KINDS,
  INVITE_REFUSALS,
  INVITE_STATES,
  INVITE_TTL_MS,
  canAccept,
  inviteExpiry,
  inviteSchema,
  inviteState,
  inviteTokenSchema,
  newInviteSchema,
  type Acceptance,
  type Invite,
} from './invite';

const T0 = new Date('2026-10-17T08:00:00Z');
const BEFORE_EXPIRY = new Date(T0.getTime() + INVITE_TTL_MS - 1);
const AT_EXPIRY = new Date(T0.getTime() + INVITE_TTL_MS);
const GROUP = '00000000-0000-4000-8000-0000000000aa';

const invite = (over: Partial<Invite> = {}): Invite => ({
  id: '00000000-0000-4000-8000-000000000001',
  coachId: 'coach',
  kind: 'group',
  groupId: GROUP,
  expiresAt: inviteExpiry(T0),
  revokedAt: null,
  usedAt: null,
  createdAt: T0,
  ...over,
});
const personal = (over: Partial<Invite> = {}): Invite =>
  invite({ kind: 'personal', groupId: null, ...over });
const coach = {
  id: 'coach',
  coachSince: T0,
  entitlement: 'free' as const,
  disabledAt: null,
};
const counts = { linkedPlayers: 0, alreadyLinked: false };
const ok = { ok: true, value: undefined };
const refused = (reason: string) => ({ ok: false, refusal: { reason } });

describe('invite vocabulary', () => {
  it('has two kinds (R-98) and four states', () => {
    expect(INVITE_KINDS).toStrictEqual(['personal', 'group']);
    expect(INVITE_STATES).toStrictEqual([
      'active',
      'expired',
      'used',
      'revoked',
    ]);
  });
  it('names its refusals and issues by catalogue key', () => {
    expect(INVITE_REFUSALS).toStrictEqual({
      invalid: 'invite.invalid',
      ownInvite: 'invite.ownInvite',
      coachFull: 'invite.coachFull',
      notCoach: 'invite.notCoach',
    });
    expect(INVITE_ISSUES).toStrictEqual({
      kindInvalid: 'invite.kindInvalid',
      groupRequired: 'invite.groupRequired',
      groupInvalid: 'invite.groupInvalid',
    });
  });
});

describe('inviteExpiry (R-99)', () => {
  it('is 7 days after creation', () => {
    expect(INVITE_TTL_MS).toBe(604_800_000);
    expect(inviteExpiry(T0)).toEqual(new Date('2026-10-24T08:00:00Z'));
  });
});

describe('inviteState', () => {
  it.each<[string, Invite, Date, string]>([
    ['active until the last millisecond', invite(), BEFORE_EXPIRY, 'active'],
    ['expired at the expiry time', invite(), AT_EXPIRY, 'expired'],
    ['an unused personal invite is active', personal(), T0, 'active'],
    ['revoked, even before expiry', invite({ revokedAt: T0 }), T0, 'revoked'],
    [
      'revoked wins over expired',
      invite({ revokedAt: T0 }),
      AT_EXPIRY,
      'revoked',
    ],
    ['a used personal invite', personal({ usedAt: T0 }), T0, 'used'],
    ['used wins over expired', personal({ usedAt: T0 }), AT_EXPIRY, 'used'],
    [
      'revoked wins over used',
      personal({ usedAt: T0, revokedAt: T0 }),
      T0,
      'revoked',
    ],
    // A group invite is multi-use (R-98): usedAt never applies to it.
    [
      'a group invite stays active after use',
      invite({ usedAt: T0 }),
      T0,
      'active',
    ],
  ])('%s', (_, subject, now, state) => {
    expect(inviteState(subject, now)).toBe(state);
  });
});

describe('canAccept', () => {
  const attempt = (over: Partial<Acceptance> = {}): Acceptance => ({
    playerId: 'player',
    coach,
    counts,
    ...over,
  });

  it('accepts an active invite for a coach below the limit', () => {
    expect(canAccept(invite(), attempt(), T0)).toStrictEqual(ok);
  });

  it('accepts an active personal invite', () => {
    expect(canAccept(personal(), attempt(), T0)).toStrictEqual(ok);
  });

  it.each<[string, Invite, Date]>([
    ['expired', invite(), AT_EXPIRY],
    ['revoked', invite({ revokedAt: T0 }), T0],
    ['used', personal({ usedAt: T0 }), T0],
  ])('refuses an %s invite with the one generic reason', (_, subject, now) => {
    expect(canAccept(subject, attempt(), now)).toStrictEqual(
      refused(INVITE_REFUSALS.invalid),
    );
  });

  it('refuses an invite from a disabled coach as not valid (R-108)', () => {
    const disabled = { ...coach, disabledAt: T0 };
    expect(canAccept(invite(), attempt({ coach: disabled }), T0)).toStrictEqual(
      refused(INVITE_REFUSALS.invalid),
    );
  });

  it("refuses the coach's own invite (checklist 5)", () => {
    expect(
      canAccept(invite(), attempt({ playerId: 'coach' }), T0),
    ).toStrictEqual(refused(INVITE_REFUSALS.ownInvite));
  });

  it('refuses when the coach switched Coach mode off', () => {
    const offCoach = { ...coach, coachSince: null };
    expect(canAccept(invite(), attempt({ coach: offCoach }), T0)).toStrictEqual(
      refused(INVITE_REFUSALS.notCoach),
    );
  });

  it('allows the 30th player and refuses the 31st (R-70)', () => {
    const at = (linkedPlayers: number) =>
      attempt({ counts: { linkedPlayers, alreadyLinked: false } });
    expect(canAccept(invite(), at(29), T0)).toStrictEqual(ok);
    expect(canAccept(invite(), at(30), T0)).toStrictEqual(
      refused(INVITE_REFUSALS.coachFull),
    );
  });

  it('lets an already linked player in at the limit: no new link is made', () => {
    const linked = attempt({
      counts: { linkedPlayers: 30, alreadyLinked: true },
    });
    expect(canAccept(invite(), linked, T0)).toStrictEqual(ok);
  });

  it('still refuses an already linked player an invalid invite', () => {
    const linked = attempt({
      counts: { linkedPlayers: 1, alreadyLinked: true },
    });
    expect(canAccept(invite({ revokedAt: T0 }), linked, T0)).toStrictEqual(
      refused(INVITE_REFUSALS.invalid),
    );
  });
});

describe('inviteSchema', () => {
  it('parses an invite row', () => {
    expect(inviteSchema.parse(invite())).toStrictEqual(invite());
  });
  it.each([
    ['an unknown kind', { kind: 'open' }],
    ['a malformed group', { groupId: 'g1' }],
    ['an empty coach', { coachId: '' }],
  ])('refuses %s', (_, over) => {
    expect(inviteSchema.safeParse({ ...invite(), ...over }).success).toBe(
      false,
    );
  });
});

describe('newInviteSchema (R-110)', () => {
  it.each([
    ['a personal invite without a group', { kind: 'personal', groupId: null }],
    ['a personal invite naming a group', { kind: 'personal', groupId: GROUP }],
    ['a group invite naming its group', { kind: 'group', groupId: GROUP }],
  ])('takes %s', (_, raw) => {
    expect(newInviteSchema.parse(raw)).toStrictEqual(raw);
  });

  it('reads a personal invite with no group field as naming none', () => {
    expect(newInviteSchema.parse({ kind: 'personal' })).toStrictEqual({
      kind: 'personal',
      groupId: null,
    });
  });

  it.each([
    [
      'a group invite without a group',
      { kind: 'group', groupId: null },
      ['groupId', 'invite.groupRequired'],
    ],
    [
      'a group invite with no group field',
      { kind: 'group' },
      ['groupId', 'invite.groupRequired'],
    ],
    [
      'a group invite with a malformed group',
      { kind: 'group', groupId: 'g1' },
      ['groupId', 'invite.groupInvalid'],
    ],
    [
      'a personal invite with a malformed group',
      { kind: 'personal', groupId: 'g1' },
      ['groupId', 'invite.groupInvalid'],
    ],
    [
      'an unknown kind',
      { kind: 'open', groupId: null },
      ['kind', 'invite.kindInvalid'],
    ],
  ])('refuses %s with a catalogue key', (_, raw, issue) => {
    expect(
      newInviteSchema
        .safeParse(raw)
        .error?.issues.map((i) => [i.path.join('.'), i.message]),
    ).toStrictEqual([issue]);
  });
});

describe('inviteTokenSchema', () => {
  it('takes 43 base64url characters', () => {
    const token = `aZ09-_${'A'.repeat(37)}`;
    expect(inviteTokenSchema.parse(token)).toBe(token);
  });
  it.each([
    ['short', 'A'.repeat(42)],
    ['long', 'A'.repeat(44)],
    ['a slash', `${'A'.repeat(42)}/`],
    ['a plus', `${'A'.repeat(42)}+`],
    ['a leading extra character', `/${'A'.repeat(43)}`],
    ['a trailing extra character', `${'A'.repeat(43)}/`],
  ])('refuses %s as not valid', (_, raw) => {
    expect(inviteTokenSchema.safeParse(raw).error?.issues[0]?.message).toBe(
      'invite.invalid',
    );
  });
});
