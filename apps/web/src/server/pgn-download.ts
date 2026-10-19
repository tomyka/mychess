// The file name a repertoire downloads under (R-96). The name is the
// owner's own text, so it never reaches the header unencoded.

import type { Locale } from '@mychess/domain';
import { MESSAGES } from '../i18n/locales';

/**
 * The download's file name: ASCII, lower case, hyphens; when nothing is
 * left, the word for a repertoire in `locale` (ASCII-safe in each catalogue).
 */
export function pgnFileName(name: string, locale: Locale): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug === '' ? MESSAGES[locale].pgn.fileNameFallback : slug}.pgn`;
}

/**
 * `value` percent-encoded as an RFC 8187 ext-value: encodeURIComponent
 * leaves `'`, `(`, `)` and `*`, which are not attr-chars, so those too. A
 * lone surrogate (which would make it throw) becomes U+FFFD first.
 */
function extValue(value: string): string {
  return encodeURIComponent(value.toWellFormed()).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** An attachment header that is safe to send: ASCII name, and the real name per RFC 6266. */
export function contentDisposition(name: string, locale: Locale): string {
  return `attachment; filename="${pgnFileName(name, locale)}"; filename*=UTF-8''${extValue(name)}.pgn`;
}
