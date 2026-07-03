import { describe, it, expect } from 'vitest';
import { parseFideSearch } from './search';

describe('parseFideSearch', () => {
  it('treats an all-digits query as a FIDE id', () => {
    expect(parseFideSearch('12865168')).toEqual({ mode: 'id', value: '12865168' });
  });

  it('trims whitespace', () => {
    expect(parseFideSearch('  123 ')).toEqual({ mode: 'id', value: '123' });
    expect(parseFideSearch(' Carlsen ')).toEqual({ mode: 'name', value: 'Carlsen' });
  });

  it('treats anything with letters as a name', () => {
    expect(parseFideSearch('Carlsen')).toEqual({ mode: 'name', value: 'Carlsen' });
    expect(parseFideSearch('Magnus Carlsen')).toEqual({ mode: 'name', value: 'Magnus Carlsen' });
  });

  it('returns null for empty/blank input', () => {
    expect(parseFideSearch('')).toBeNull();
    expect(parseFideSearch('   ')).toBeNull();
  });
});
