import { describe, expect, it } from 'vitest';
import {
  importIntoRoute,
  repertoireExportRoute,
  repertoireRoute,
  ROUTES,
} from './routes';

describe('ROUTES', () => {
  it('names the repertoire list and the import page in Lithuanian', () => {
    expect(ROUTES.repertoires).toBe('/repertuarai');
    expect(ROUTES.repertoireImport).toBe('/repertuarai/importuoti');
  });
});

describe('repertoireRoute', () => {
  it('is the repertoire list path followed by the id', () => {
    expect(repertoireRoute('3f1c')).toBe('/repertuarai/3f1c');
  });
});

describe('repertoireExportRoute', () => {
  it('is the English API path for the PGN download', () => {
    expect(repertoireExportRoute('3f1c')).toBe('/api/repertoires/3f1c/export');
  });
});

describe('importIntoRoute', () => {
  it('preselects the target repertoire on the import page', () => {
    expect(importIntoRoute('3f1c')).toBe('/repertuarai/importuoti?i=3f1c');
  });

  it('encodes the id as a query value', () => {
    expect(importIntoRoute('a&b c')).toBe(
      '/repertuarai/importuoti?i=a%26b%20c',
    );
  });
});
