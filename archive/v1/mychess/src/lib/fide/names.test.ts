import { describe, it, expect } from 'vitest';
import { namesMatch } from './names';

describe('namesMatch', () => {
  it('matches identical names', () => {
    expect(namesMatch('Tomas', 'Konovalovas', 'Tomas', 'Konovalovas')).toBe(true);
  });

  it('ignores case', () => {
    expect(namesMatch('tomas', 'konovalovas', 'Tomas', 'Konovalovas')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(namesMatch(' Tomas ', ' Konovalovas ', 'Tomas', 'Konovalovas')).toBe(true);
  });

  it('rejects a mismatched first name', () => {
    expect(namesMatch('Magnus', 'Konovalovas', 'Tomas', 'Konovalovas')).toBe(false);
  });

  it('rejects a mismatched last name', () => {
    expect(namesMatch('Tomas', 'Carlsen', 'Tomas', 'Konovalovas')).toBe(false);
  });
});
