import { describe, expect, it } from 'vitest';
import { auditEmailHash } from '../src';

// R-88: an audit row names its target by a one-way hash of the canonical
// email, which an operator recomputes to ask "was this email ever audited".
describe('auditEmailHash', () => {
  it('is the hex SHA-256 of the canonical email', () => {
    expect(auditEmailHash('ruta@example.lt')).toBe(
      'cade0ed8e54971329a51ec35d4e62651c18fa134c22619f504ba27dd38afcca0',
    );
    expect(auditEmailHash('jonas@example.lt')).toBe(
      '64dd35cb8a16ff22698f33573727ce1251da46888916f78ac22b7307cbcb0273',
    );
  });

  it('gives the same hash every time for the same email', () => {
    expect(auditEmailHash('ruta@example.lt')).toBe(
      auditEmailHash('ruta@example.lt'),
    );
  });
});
