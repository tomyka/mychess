import { describe, expect, it } from 'vitest';
import {
  coachGroupPath,
  coachPlayerPath,
  importIntoRoute,
  invitePath,
  repertoireDeletedRoute,
  repertoireExportRoute,
  repertoireRoute,
  ROUTES,
} from './routes';

describe('ROUTES', () => {
  it('names the repertoire list and the import page in Lithuanian', () => {
    expect(ROUTES.repertoires).toBe('/repertuarai');
    expect(ROUTES.repertoireImport).toBe('/repertuarai/importuoti');
  });

  it('names the coach area and the "Mano treneriai" section of settings', () => {
    expect(ROUTES.coach).toBe('/treneris');
    expect(ROUTES.myCoaches).toBe('/nustatymai#treneriai');
  });
});

describe('invitePath', () => {
  it('is /k/ followed by the token', () => {
    expect(invitePath('abc_-1')).toBe('/k/abc_-1');
  });

  it('encodes the token as one path segment', () => {
    expect(invitePath('a/b?c')).toBe('/k/a%2Fb%3Fc');
  });
});

describe('coachPlayerPath', () => {
  it('is the coach area player page for the id, encoded', () => {
    expect(coachPlayerPath('p1')).toBe('/treneris/zaidejai/p1');
    expect(coachPlayerPath('a/b')).toBe('/treneris/zaidejai/a%2Fb');
  });
});

describe('coachGroupPath', () => {
  it('is the coach area group page for the id, encoded', () => {
    expect(coachGroupPath('g1')).toBe('/treneris/grupes/g1');
    expect(coachGroupPath('a b')).toBe('/treneris/grupes/a%20b');
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

describe('repertoireDeletedRoute', () => {
  it('is the repertoire list, told a repertoire was deleted', () => {
    expect(repertoireDeletedRoute).toBe('/repertuarai?deleted=1');
  });
});
