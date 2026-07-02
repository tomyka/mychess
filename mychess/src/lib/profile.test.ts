import { describe, it, expect } from 'vitest';
import { fullNameOrNull, isPlaceholderName } from './profile';

describe('fullNameOrNull', () => {
  it('joins first and last name', () => {
    expect(fullNameOrNull('Magnus', 'Carlsen')).toBe('Magnus Carlsen');
  });

  it('trims surrounding whitespace on each part', () => {
    expect(fullNameOrNull('  Magnus  ', ' Carlsen ')).toBe('Magnus Carlsen');
  });

  it('returns first name alone when last name missing', () => {
    expect(fullNameOrNull('Magnus', '')).toBe('Magnus');
    expect(fullNameOrNull('Magnus', null)).toBe('Magnus');
  });

  it('returns last name alone when first name missing', () => {
    expect(fullNameOrNull('', 'Carlsen')).toBe('Carlsen');
    expect(fullNameOrNull(null, 'Carlsen')).toBe('Carlsen');
  });

  it('returns null when neither name is present', () => {
    expect(fullNameOrNull('', '')).toBeNull();
    expect(fullNameOrNull(null, undefined)).toBeNull();
    expect(fullNameOrNull('   ', '  ')).toBeNull();
  });
});

describe('isPlaceholderName', () => {
  it('treats the guest placeholder as a placeholder', () => {
    expect(isPlaceholderName('Guest')).toBe(true);
  });

  it('treats empty/nullish names as placeholders', () => {
    expect(isPlaceholderName('')).toBe(true);
    expect(isPlaceholderName('   ')).toBe(true);
    expect(isPlaceholderName(null)).toBe(true);
    expect(isPlaceholderName(undefined)).toBe(true);
  });

  it('treats a real name as not a placeholder', () => {
    expect(isPlaceholderName('Magnus Carlsen')).toBe(false);
  });
});
