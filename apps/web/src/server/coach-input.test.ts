import { describe, expect, it } from 'vitest';
import {
  parseCoachNote,
  parseCoachNoteMove,
  parseGroupName,
  parseNewInvite,
} from './coach-input';

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

const REPERTOIRE = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const TARGET = { playerId: 'p-1', repertoireId: REPERTOIRE, moveKey: 'k|e4' };

describe('parseCoachNoteMove', () => {
  it('takes a player, a repertoire and a move key', () => {
    expect(parseCoachNoteMove({ ...TARGET, coachId: 'c-9' })).toEqual({
      ok: true,
      value: TARGET,
    });
  });

  it.each([
    ['no player', { ...TARGET, playerId: '' }, 'access.notLinked'],
    [
      'a player id too long',
      { ...TARGET, playerId: 'p'.repeat(101) },
      'access.notLinked',
    ],
    [
      'a malformed repertoire',
      { ...TARGET, repertoireId: 'nėra' },
      'access.notShared',
    ],
    ['no move key', { ...TARGET, moveKey: '' }, 'coachNote.moveNotFound'],
    [
      'a move key too long',
      { ...TARGET, moveKey: 'k'.repeat(121) },
      'coachNote.moveNotFound',
    ],
    ['no object', null, 'access.notShared'],
  ])('refuses %s', (_, input, reason) => {
    expect(parseCoachNoteMove(input)).toEqual({
      ok: false,
      refusal: { reason },
    });
  });
});

describe('parseCoachNote', () => {
  it('trims the text', () => {
    expect(parseCoachNote({ ...TARGET, text: '  Bf4 pirmiau  ' })).toEqual({
      ok: true,
      value: { ...TARGET, text: 'Bf4 pirmiau' },
    });
  });

  it('keeps a note of 2000 characters', () => {
    expect(
      parseCoachNote({ ...TARGET, text: 'a'.repeat(2000) }),
    ).toHaveProperty('ok', true);
  });

  it.each([
    ['blank', { ...TARGET, text: '  ' }, 'coachNote.blank'],
    ['too long', { ...TARGET, text: 'a'.repeat(2001) }, 'coachNote.tooLong'],
    ['not text', { ...TARGET, text: 5 }, 'coachNote.blank'],
    ['without a target', { text: 'Pastaba' }, 'access.notLinked'],
  ])('refuses a note that is %s', (_, input, reason) => {
    expect(parseCoachNote(input)).toEqual({ ok: false, refusal: { reason } });
  });
});
