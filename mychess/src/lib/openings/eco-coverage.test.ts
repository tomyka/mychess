import { describe, it, expect } from 'vitest';
import { ECO_OPENINGS } from './eco-data';
import { ECO_NAMES_LT } from './eco-data-lt';

describe('Lithuanian ECO coverage', () => {
  it('names every code that the English data carries', () => {
    const missing = ECO_OPENINGS.map((o) => o.code).filter((code) => !(code in ECO_NAMES_LT));
    // A non-empty list means `eco:generate` introduced codes that
    // `eco:generate:lt` has not been re-run for. Those codes fall back to
    // English rather than rendering blank, so this is a prompt to regenerate,
    // not a production outage.
    expect(missing).toEqual([]);
  });

  it('carries no Lithuanian name for a code the English data does not have', () => {
    const codes = new Set(ECO_OPENINGS.map((o) => o.code));
    expect(Object.keys(ECO_NAMES_LT).filter((code) => !codes.has(code))).toEqual([]);
  });

  it('has no blank names', () => {
    expect(Object.entries(ECO_NAMES_LT).filter(([, name]) => name.trim() === '')).toEqual([]);
  });
});
