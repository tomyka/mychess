import { describe, expect, it } from 'vitest';
import { contentDisposition, pgnFileName } from './pgn-download';

describe('pgnFileName', () => {
  it('is the name in ASCII, lower case, words joined by hyphens', () => {
    expect(pgnFileName('Sicilijos gynyba, Taimanovo variantas', 'lt')).toBe(
      'sicilijos-gynyba-taimanovo-variantas.pgn',
    );
  });

  it('drops diacritics, quotation marks and symbols, and trims hyphens', () => {
    expect(pgnFileName('„Šach“ #1', 'lt')).toBe('sach-1.pgn');
    expect(pgnFileName('--Ąžuolas--', 'lt')).toBe('azuolas.pgn');
  });

  it("falls back to the account's word for a repertoire when nothing is left", () => {
    expect(pgnFileName('???', 'lt')).toBe('repertuaras.pgn');
    expect(pgnFileName('', 'lt')).toBe('repertuaras.pgn');
    expect(pgnFileName('???', 'en')).toBe('repertoire.pgn');
  });

  it('keeps no character that could break a header', () => {
    expect(pgnFileName('a"b\r\nc;d\\e/f', 'lt')).toBe('a-b-c-d-e-f.pgn');
  });
});

describe('contentDisposition', () => {
  it('is an attachment with the ASCII name and the real name per RFC 6266', () => {
    expect(contentDisposition('Ąžuolas', 'lt')).toBe(
      'attachment; filename="azuolas.pgn"; filename*=UTF-8\'\'%C4%84%C5%BEuolas.pgn',
    );
  });

  it("names a name with nothing ASCII left in the account's language", () => {
    expect(contentDisposition('?', 'en')).toBe(
      'attachment; filename="repertoire.pgn"; filename*=UTF-8\'\'%3F.pgn',
    );
  });

  it('percent-encodes quotes, line breaks and separators in the real name', () => {
    const header = contentDisposition('a"b\r\nc; d', 'lt');
    expect(header).toBe(
      'attachment; filename="a-b-c-d.pgn"; filename*=UTF-8\'\'a%22b%0D%0Ac%3B%20d.pgn',
    );
    expect(header).not.toMatch(/[\r\n]/u);
  });

  it('does not throw on a lone surrogate, which has no UTF-8 form', () => {
    expect(contentDisposition('a\uD800b', 'lt')).toBe(
      'attachment; filename="a-b.pgn"; filename*=UTF-8\'\'a%EF%BF%BDb.pgn',
    );
  });

  it('percent-encodes the characters encodeURIComponent leaves (RFC 5987 attr-char)', () => {
    expect(contentDisposition("O'Kelly (*)", 'lt')).toBe(
      'attachment; filename="o-kelly.pgn"; filename*=UTF-8\'\'O%27Kelly%20%28%2A%29.pgn',
    );
  });
});
