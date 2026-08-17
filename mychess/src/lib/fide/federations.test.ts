import { describe, it, expect } from 'vitest';
import { EUROPEAN_FEDERATIONS, isEuropeanFederation } from './federations';

describe('isEuropeanFederation', () => {
  it('includes ECU member federations', () => {
    expect(isEuropeanFederation('LTU')).toBe(true);
    expect(isEuropeanFederation('GER')).toBe(true);
    expect(isEuropeanFederation('ENG')).toBe(true);
  });

  it('excludes non-European federations', () => {
    expect(isEuropeanFederation('USA')).toBe(false);
    expect(isEuropeanFederation('CHN')).toBe(false);
  });

  it('excludes Russia despite historical FIDE Europe zone grouping', () => {
    expect(isEuropeanFederation('RUS')).toBe(false);
  });

  it('has exactly 54 member federations (current ECU membership)', () => {
    expect(EUROPEAN_FEDERATIONS.size).toBe(54);
  });
});
