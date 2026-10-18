import { describe, expect, it } from 'vitest';
import { parseGroupName, parseNewInvite } from './coach-input';

const GROUP = '0b7f3c2e-8a1d-4e5f-9a6b-1c2d3e4f5a6b';

function form(fields: Readonly<Record<string, string | Blob>>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe('parseGroupName', () => {
  it('trims the name', () => {
    expect(parseGroupName(form({ name: '  Šeštadienio grupė ' }))).toEqual({
      ok: true,
      value: 'Šeštadienio grupė',
    });
  });

  it.each([
    ['blank', form({ name: '   ' }), 'groupName.blank'],
    ['missing', form({}), 'groupName.blank'],
    ['a file', form({ name: new Blob(['x']) }), 'groupName.blank'],
    ['too long', form({ name: 'a'.repeat(61) }), 'groupName.tooLong'],
  ])('refuses a name that is %s', (_, data, reason) => {
    expect(parseGroupName(data)).toEqual({ ok: false, refusal: { reason } });
  });

  it('keeps a name of 60 characters', () => {
    expect(parseGroupName(form({ name: 'a'.repeat(60) }))).toEqual({
      ok: true,
      value: 'a'.repeat(60),
    });
  });
});

describe('parseNewInvite (R-110)', () => {
  it.each([
    ['a personal invite', { kind: 'personal' }, null],
    [
      'a personal invite with an empty group',
      { kind: 'personal', groupId: '' },
      null,
    ],
    [
      'a personal invite into a group',
      { kind: 'personal', groupId: GROUP },
      GROUP,
    ],
  ])('reads %s', (_, fields, groupId) => {
    expect(parseNewInvite(form(fields))).toEqual({
      ok: true,
      value: { kind: 'personal', groupId },
    });
  });

  it('reads a group invite', () => {
    expect(parseNewInvite(form({ kind: 'group', groupId: GROUP }))).toEqual({
      ok: true,
      value: { kind: 'group', groupId: GROUP },
    });
  });

  it.each([
    [
      'a group invite without a group',
      { kind: 'group' },
      'invite.groupRequired',
    ],
    [
      'a group invite with an empty group',
      { kind: 'group', groupId: '' },
      'invite.groupRequired',
    ],
    ['an unknown kind', { kind: 'club' }, 'invite.kindInvalid'],
    ['no kind', {}, 'invite.kindInvalid'],
    [
      'a malformed group',
      { kind: 'personal', groupId: 'x' },
      'invite.groupInvalid',
    ],
    [
      'a file for a group',
      { kind: 'personal', groupId: new Blob(['x']) },
      'invite.groupInvalid',
    ],
  ])('refuses %s', (_, fields, reason) => {
    expect(parseNewInvite(form(fields))).toEqual({
      ok: false,
      refusal: { reason },
    });
  });
});
