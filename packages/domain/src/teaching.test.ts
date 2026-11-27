import { describe, expect, it } from 'vitest';
import { isTeachingMaterial } from './teaching';

describe('isTeachingMaterial (R-230)', () => {
  const assigned = new Set(['r1']);

  it('is an own repertoire assigned to at least one player or group', () => {
    expect(
      isTeachingMaterial({ kind: 'own', repertoire: { id: 'r1' } }, assigned),
    ).toBe(true);
  });

  it('is not an own repertoire assigned to no one', () => {
    expect(
      isTeachingMaterial({ kind: 'own', repertoire: { id: 'r2' } }, assigned),
    ).toBe(false);
  });

  it('is not a repertoire the account has by assignment', () => {
    expect(
      isTeachingMaterial(
        { kind: 'assigned', repertoire: { id: 'r1' } },
        assigned,
      ),
    ).toBe(false);
  });
});
