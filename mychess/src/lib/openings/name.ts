// mychess/src/lib/openings/name.ts
import { ECO_NAMES_LT } from './eco-data-lt';

/**
 * The opening name to display for a code (GitHub issue #158).
 *
 * `repertoires.eco_name` stores whatever ENGLISH name was detected at import,
 * so it cannot be localised — the Lithuanian name has to be looked up from the
 * code instead. English callers keep getting the string they already had.
 *
 * The English name is passed in rather than looked up because the two kinds of
 * caller hold it differently: the picker has an `Opening` from `ECO_OPENINGS`,
 * while the repertoire lists have a stored row. One signature serves both.
 *
 * `namesLt` is injectable for tests, defaulting to the generated table — the
 * same shape `detectOpening` uses for `openings`.
 *
 * Falls back to English per entry. Coverage is complete today (500 of 500), so
 * this matters only if a future `eco:generate` introduces codes that
 * `eco:generate:lt` has not picked up — `eco-coverage.test.ts` fails when that
 * happens, and until someone regenerates, those few render in English rather
 * than blank.
 */
export function localizedOpeningName(args: {
  code: string | null;
  englishName: string | null;
  locale: string;
  namesLt?: Record<string, string>;
}): string | null {
  const { code, englishName, locale, namesLt = ECO_NAMES_LT } = args;
  if (!code) return englishName ?? null;
  if (locale === 'lt') return namesLt[code] ?? englishName ?? null;
  return englishName ?? null;
}
