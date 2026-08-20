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
  it('leaves a player who is actually called Guest alone', () => {
    // Was a placeholder while the guest-auth flow named profiles "Guest";
    // those rows are gone (#90), so the literal is just a name now.
    expect(isPlaceholderName('Guest')).toBe(false);
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
