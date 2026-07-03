export type FideSearch = { mode: 'id' | 'name'; value: string };

/**
 * Classifies a lookup query: an all-digits value is a FIDE id (prefix match),
 * anything else is a name search. Returns null for blank input.
 */
export function parseFideSearch(q: string): FideSearch | null {
  const value = q.trim();
  if (!value) return null;
  return /^\d+$/.test(value) ? { mode: 'id', value } : { mode: 'name', value };
}
