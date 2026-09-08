# Lithuanian names for ECO opening codes

GitHub issue #158. Follow-up to epic #112 (Lithuanian language support), which
shipped the i18n infrastructure and translated the UI but deliberately deferred
ECO opening names.

## Problem

`src/lib/openings/eco-data.ts` holds 500 openings — one per ECO code, generated
by `npm run eco:generate` from lichess-org/chess-openings (CC0 1.0). Their names
are English only, and they render unchanged whatever the active locale:

- `OpeningPicker.svelte` lists all 500 as `{code} — {name}`
- the coach and player repertoire lists render `repertoires.eco_name`

`eco_name` is denormalised into `repertoires` at import time, so the stored
string is whatever English name was detected then. A stored English string
cannot be localised, which is the crux: names have to be derived from
`eco_code` at render time.

## Source

Lithuanian names come from the opening encyclopaedia at
`http://www.xn--achmatai-4wb.lt` (šachmatai.lt), supplied by the maintainer.

Its structure matters, because the obvious page is the wrong one:

- `?id=E` is a **volume index** — 10 decade headings, one per `E0`…`E9`, several
  of which read `Įvairūs debiutai` ("various openings"). Useless on its own.
- `?id=E0` … `?id=E9` are **decade pages**, and these carry a name for every
  individual code.

50 decade pages cover all 500 codes.

### Coverage, measured

Scraping all 50 pages yields **500 of 500 codes named, with zero gaps against
the exact code set in `eco-data.ts`**. No drafting, no composition and no
per-segment fallback are needed. An earlier draft of this design proposed a
hand-reviewed vocabulary of ~280 units precisely because the volume index had
been mistaken for the whole source; the decade pages made all of it redundant.

### What the data looks like

- **381 distinct names across 500 codes.** `Siciliška gynyba` covers 12 codes,
  `Angliškas debiutas` 11. Less distinctive than the lichess names, but the
  picker already renders the code alongside, so entries stay distinguishable.
- **159 names carry ECO move disambiguation** in Lithuanian piece notation:
  `Benoni gynyba, 6.e4`, `Klasikinė Benoni gynyba, be 9.O-O` (`be` = without),
  `Že1` for a knight move.
- **Comma-separated hierarchy**, not the lichess colon: `Siciliška gynyba,
  Naidorfo variantas`.
- These are **not translations of the lichess names**. They are an independent
  Lithuanian ECO taxonomy, and for a given code the two may name a different
  level of detail. Both are valid names for that code.

**Names are stored verbatim.** No cleaning of move notation, no colon
normalisation, no dedup. The source's own disambiguation is the authentic ECO
wording, and editing it would reintroduce exactly the per-entry judgement calls
that using this source eliminates.

## Design

### 1. Generated Lithuanian table

`scripts/generate-eco-data-lt.ts`, wired as `npm run eco:generate:lt`, fetches
the 50 decade pages, extracts code → name, and writes
`src/lib/openings/eco-data-lt.ts`:

```ts
export const ECO_NAMES_LT: Record<string, string> = { "A00": "Nepopuliarūs debiutai", ... };
```

Deliberately a **separate command from `eco:generate`**, not an extension of it:
the two sources fail independently, and a markup change on šachmatai.lt must not
be able to break regeneration of the English data.

The file header credits both sources, as the English generator already does for
lichess.

### 2. One lookup helper

```ts
localizedOpeningName(args: {
  code: string | null;
  englishName: string | null;
  locale: string;
  namesLt?: Record<string, string>;
}): string | null
```

in `src/lib/openings/name.ts`. Returns the Lithuanian name when
`locale === 'lt'` and the code is present; otherwise the English name
unchanged. Locale comes from Paraglide's `getLocale()`, passed in by the
caller so the helper stays pure.

`namesLt` defaults to the generated table and is injectable for tests — the
same shape `detectOpening(sanMoves, openings)` already uses in `classify.ts`,
so a unit test never depends on the 500-entry generated file.

Per-entry English fallback is retained even though coverage is complete today —
it is what keeps a future lichess regeneration that adds codes from rendering
blank names.

### 3. Rendering

Three call sites, all of them currently rendering the field directly:

| file | line | today |
| --- | --- | --- |
| `src/lib/components/OpeningPicker.svelte` | 85 | `{opening.code} — {opening.name}` from `ECO_OPENINGS` |
| `src/routes/(player)/repertoires/+page.svelte` | 38 | `{rep.eco_code} — {rep.eco_name}` from the row |
| `src/routes/(coach)/coach/repertoires/+page.svelte` | 88-89 | `{rep.eco_code}` + `— {rep.eco_name}` from the row |

Each becomes a call to the helper. Note the picker reads the in-memory
`ECO_OPENINGS` list while the two lists read the stored row, so the helper takes
the English name as an argument rather than looking it up — one signature serves
both shapes.

`OpeningPicker.svelte:82` also posts `eco_name` as a hidden input, and keeps
posting the English name: that value is what gets stored, and storage stays
English by design (below).

`repertoires.eco_name` keeps being written as the English string. It stays a
record of what was detected at import; display simply stops trusting it under
`lt`. Dropping the column is not part of this work.

### 4. Not Paraglide messages

#158 suggested wiring the names into the message files. Rejected: message files
are hand-written UI copy, and 500 generated data rows would swamp them, could
not survive regeneration, and would have Paraglide compile 500 functions for
what is a lookup table. Only locale *detection* comes from Paraglide.

## Testing

- Helper unit tests: `lt` hit, `lt` miss falling back to English, `en` passthrough, null code.
- **A data test asserting every code in `ECO_OPENINGS` has an entry in `ECO_NAMES_LT`.** This is the guard that matters — it fails loudly when a lichess regeneration introduces codes the Lithuanian table does not cover.
- A test that the scraper's parse of a checked-in page fixture yields the expected code → name pairs, so a markup change is diagnosed rather than silently producing an empty table.

## Verification

- `npm run check`, `npm run lint`, `npm test` clean.
- Spot-check the 500 generated names — the maintainer reviews the generated file rather than producing translations.
- Confirm the picker and both repertoire lists render Lithuanian under `lt` and English under `en`.

## Open item: permission to redistribute

Using a handful of Lithuanian chess terms is using terminology. Committing all
500 of the site's names into the app bundle is redistributing its dataset.
Individual opening names are factual labels with little protection, but the EU
sui generis database right covers systematic extraction of a substantial part of
a database, and both this project and the site are in the EU.

**Recommendation: ask the site owner for permission and offer credit before
shipping.** Cheap, and it removes the question. The generator header credits the
site regardless. This is recorded as a pre-ship item rather than a blocker on
the implementation work.

## Non-Goals

- Re-scoping any other part of #112. That epic is closed.
- Translating the Lithuanian piece notation inside names, or normalising it to English.
- Dropping `repertoires.eco_name`.
- Localising ECO names into any locale beyond `lt`.
