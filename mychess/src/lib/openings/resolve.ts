// mychess/src/lib/openings/resolve.ts
import { CURATED_OPENINGS, type CuratedOpening } from './taxonomy';
import type { Locale } from '$lib/paraglide/runtime';

/**
 * Which curated opening a repertoire prepares (GitHub issue #201).
 *
 * THE ONLY WAY ANYTHING SHOULD ASK THIS. `repertoires.opening_id` holds only a
 * coach's explicit correction, so it is null on almost every row — a call site
 * reading the column directly sees nothing and renders blank, silently. That is
 * why resolution lives here and why `resolve.test.ts` pins the null-column case
 * to derivation rather than to null.
 *
 * Deriving rather than storing at import is deliberate: the taxonomy is still
 * being authored, and a stored answer would freeze each repertoire at whatever
 * the list said on its import day, needing a data migration per revision.
 * Editing the list instead re-answers for every repertoire at once.
 *
 * An override naming a since-deleted entry resolves to null rather than
 * falling back to derivation: the coach's stated answer is gone, and quietly
 * substituting a different opening would be worse than showing the ECO line.
 */
export function resolveOpening(
  repertoire: { eco_code: string | null; color: string | null; opening_id: string | null },
  taxonomy: CuratedOpening[] = CURATED_OPENINGS
): CuratedOpening | null {
  if (repertoire.opening_id) {
    return taxonomy.find((opening) => opening.id === repertoire.opening_id) ?? null;
  }
  if (!repertoire.eco_code) return null;
  return (
    taxonomy.find(
      (opening) => opening.side === repertoire.color && opening.ecoCodes.includes(repertoire.eco_code as string)
    ) ?? null
  );
}

/** The display name for a resolved opening, in the active locale. */
export function curatedOpeningName(opening: CuratedOpening | null, locale: Locale): string | null {
  if (!opening) return null;
  return locale === 'lt' ? opening.nameLt : opening.name;
}
