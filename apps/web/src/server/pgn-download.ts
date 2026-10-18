// The file name a repertoire downloads under (R-96). The name is the
// owner's own text, so it never reaches the header unencoded.

const FALLBACK = 'repertuaras';

/** The download's file name: ASCII, lower case, hyphens; a fallback when nothing is left. */
export function pgnFileName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug === '' ? FALLBACK : slug}.pgn`;
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
export function contentDisposition(name: string): string {
  return `attachment; filename="${pgnFileName(name)}"; filename*=UTF-8''${extValue(name)}.pgn`;
}
