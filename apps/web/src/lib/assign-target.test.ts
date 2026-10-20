import { describe, expect, it } from 'vitest';
import { targetField, targetFromField } from './assign-target';

describe('the assign picker’s target field', () => {
  it('names a player or a group by kind and id', () => {
    expect(targetField('player', 'rokas')).toBe('player:rokas');
    expect(targetField('group', 'g-1')).toBe('group:g-1');
  });

  it('reads back what it wrote', () => {
    expect(targetFromField('player:rokas')).toEqual({
      kind: 'player',
      playerId: 'rokas',
    });
    expect(targetFromField('group:g-1')).toEqual({
      kind: 'group',
      groupId: 'g-1',
    });
  });

  it('splits at the first colon only, so an id may hold one', () => {
    expect(targetFromField('player:a:b')).toEqual({
      kind: 'player',
      playerId: 'a:b',
    });
  });

  it('reads nothing picked as no target', () => {
    expect(targetFromField('')).toBeUndefined();
    expect(targetFromField(null)).toBeUndefined();
  });

  it('passes anything else on for the schema to refuse', () => {
    expect(targetFromField('coach')).toEqual({ kind: 'coach', playerId: '' });
    expect(targetFromField('group:')).toEqual({ kind: 'group', groupId: '' });
  });
});
