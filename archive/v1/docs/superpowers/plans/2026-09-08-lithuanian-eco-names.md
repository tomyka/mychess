# Lithuanian ECO Opening Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render ECO opening names in Lithuanian under the `lt` locale, sourced per-code from šachmatai.lt, falling back to the existing English names.

**Architecture:** A pure parser turns one decade page's HTML into `code → name` pairs. A one-off script fetches all 50 decade pages, runs the parser, and writes a generated `ECO_NAMES_LT` lookup table. A pure helper picks the Lithuanian or English name for a locale. Three render sites call the helper. A data test fails if the table ever stops covering `ECO_OPENINGS`.

**Tech Stack:** TypeScript, SvelteKit 2 / Svelte 5 runes, vitest, Paraglide (locale detection only), `tsx` for the generator script.

**Spec:** `docs/superpowers/specs/2026-09-08-lithuanian-eco-names-design.md`

**Working directory:** all `npm` commands run from `mychess/`.

---

### Task 1: Pure parser for one decade page

The generator must not hold the parsing logic: parsing is pure and testable, fetching is not. This mirrors the repo's split of pure logic in `src/lib/` from I/O elsewhere.

**Files:**
- Create: `mychess/src/lib/openings/eco-lt-parse.ts`
- Create: `mychess/src/lib/openings/eco-lt-parse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mychess/src/lib/openings/eco-lt-parse.test.ts`. The fixture is a trimmed copy of the real markup from `?id=E0` — codes appear as their own cell, and the name is the next `- `-prefixed line. Lines like `- be 3. g3` (Lithuanian "without") and `- su 3... d5` ("with") are move qualifiers, not names, and must be skipped.

```ts
import { describe, it, expect } from 'vitest';
import { parseDecadePage } from './eco-lt-parse';

const FIXTURE = `
<table>
<tr><td>E00</td><td>- Valdovės pėstininko debiutas</td></tr>
<tr><td></td><td>1. d4 Žf6 2. c4 e6</td></tr>
<tr><td></td><td>- be 3. g3, 3. Žf3, 3. Žc3</td></tr>
<tr><td>E01</td><td>- Kataloniškas debiutas, Uždaras variantas</td></tr>
<tr><td></td><td>- su 3... d5</td></tr>
<tr><td>E04</td><td>- Kataloniškas debiutas, Atviras variantas 5.Žf3</td></tr>
<script>var x = "E99";</script>
`;

describe('parseDecadePage', () => {
  it('maps each ECO code to the Lithuanian name that follows it', () => {
    expect(parseDecadePage(FIXTURE, 'E0')).toEqual({
      E00: 'Valdovės pėstininko debiutas',
      E01: 'Kataloniškas debiutas, Uždaras variantas',
      E04: 'Kataloniškas debiutas, Atviras variantas 5.Žf3'
    });
  });

  it('ignores codes outside the requested decade', () => {
    const html = '<td>E00</td><td>- Vienas</td><td>D50</td><td>- Kitas</td>';
    expect(parseDecadePage(html, 'E0')).toEqual({ E00: 'Vienas' });
  });

  it('returns an empty object when the markup carries no codes', () => {
    expect(parseDecadePage('<p>Nieko čia nėra</p>', 'E0')).toEqual({});
  });

  it('decodes HTML entities in names', () => {
    expect(parseDecadePage('<td>E00</td><td>- Karaliaus &amp; valdovės debiutas</td>', 'E0')).toEqual({
      E00: 'Karaliaus & valdovės debiutas'
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/openings/eco-lt-parse.test.ts`
Expected: FAIL — `Failed to resolve import "./eco-lt-parse"`.

- [ ] **Step 3: Write the parser**

Create `mychess/src/lib/openings/eco-lt-parse.ts`:

```ts
// mychess/src/lib/openings/eco-lt-parse.ts
//
// Parses one decade page of šachmatai.lt's opening encyclopaedia
// (`debiutu_enciklopedija.php?id=E0`) into `code → Lithuanian name` pairs.
// Pure, so the shape of that site's markup is testable without fetching it —
// `scripts/generate-eco-data-lt.ts` does the fetching (GitHub issue #158).
//
// The page nests each code in its own cell, with the name on the next
// `- `-prefixed line. Two other `- ` lines appear and are NOT names: `- be …`
// ("without") and `- su …` ("with") carry the move qualifiers that separate
// sibling codes.

/** Minimal entity decode. The pages are UTF-8, so Lithuanian letters arrive literal. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * `decade` is the two-character prefix the page covers, e.g. `E0` for
 * `E00`-`E09`. Codes from other decades are ignored: the pages carry
 * navigation listing every volume, and without this filter that navigation
 * would contribute bogus pairs.
 */
export function parseDecadePage(html: string, decade: string): Record<string, string> {
  const withoutScripts = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  const lines = decodeEntities(withoutScripts.replace(/<[^>]+>/g, '\n'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const codePattern = new RegExp(`^${decade}\\d$`);
  const names: Record<string, string> = {};

  for (const [index, line] of lines.entries()) {
    if (!codePattern.test(line)) continue;
    for (const candidate of lines.slice(index + 1, index + 3)) {
      if (!candidate.startsWith('- ')) continue;
      if (/^- (be|su)\b/.test(candidate)) continue;
      const name = candidate.slice(2).trim();
      if (name && !(line in names)) names[line] = name;
      break;
    }
  }

  return names;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/openings/eco-lt-parse.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/openings/eco-lt-parse.ts mychess/src/lib/openings/eco-lt-parse.test.ts
git commit -m "feat(openings): parse a Lithuanian ECO decade page (GitHub issue #158)"
```

---

### Task 2: Generator script and the generated table

**Files:**
- Create: `mychess/scripts/generate-eco-data-lt.ts`
- Create (by running it): `mychess/src/lib/openings/eco-data-lt.ts`
- Modify: `mychess/package.json` (add the `eco:generate:lt` script)

- [ ] **Step 1: Write the generator**

Create `mychess/scripts/generate-eco-data-lt.ts`:

```ts
// mychess/scripts/generate-eco-data-lt.ts
//
// Writes src/lib/openings/eco-data-lt.ts — the Lithuanian name for every ECO
// code (GitHub issue #158).
//
// Deliberately a SEPARATE command from `eco:generate` rather than an extension
// of it. That script fetches lichess's TSVs; this one scrapes a third party's
// HTML, which is far more likely to break. Keeping them apart means a markup
// change on šachmatai.lt cannot stop the English data being regenerated.
//
// The volume index pages (`?id=E`) are NOT the source: they carry only ten
// decade headings, several of them the placeholder "Įvairūs debiutai". The
// per-code names live on the decade pages (`?id=E0` … `?id=E9`), 50 in total.
import { writeFileSync } from 'fs';
import { parseDecadePage } from '../src/lib/openings/eco-lt-parse';

const BASE_URL = 'http://www.xn--achmatai-4wb.lt/debiutu_enciklopedija.php';
const OUT_PATH = 'src/lib/openings/eco-data-lt.ts';
const VOLUMES = ['A', 'B', 'C', 'D', 'E'];

async function fetchDecade(decade: string): Promise<Record<string, string>> {
  const res = await fetch(`${BASE_URL}?id=${decade}`);
  if (!res.ok) throw new Error(`Failed to fetch ${decade}: HTTP ${res.status}`);
  return parseDecadePage(await res.text(), decade);
}

async function main() {
  const names: Record<string, string> = {};
  for (const volume of VOLUMES) {
    for (let digit = 0; digit <= 9; digit++) {
      const decade = `${volume}${digit}`;
      const found = await fetchDecade(decade);
      if (Object.keys(found).length === 0) {
        throw new Error(`${decade} yielded no names — the page markup has probably changed.`);
      }
      Object.assign(names, found);
      process.stdout.write(`${decade}:${Object.keys(found).length} `);
    }
  }
  process.stdout.write('\n');

  const sorted = Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b)));
  const content = `// Generated by scripts/generate-eco-data-lt.ts — do not edit by hand.
// Lithuanian ECO opening names, one per code.
// Source: http://www.xn--achmatai-4wb.lt/debiutu_enciklopedija.php (šachmatai.lt)
// English names come from a different source — see eco-data.ts (lichess, CC0 1.0).
//
// Names are stored VERBATIM, including the move disambiguation many of them
// carry ("Benoni gynyba, 6.e4", "be 9.O-O") in Lithuanian piece notation.
// Cleaning them up would mean re-deciding each entry by hand, which using this
// source exists to avoid (GitHub issue #158).

export const ECO_NAMES_LT: Record<string, string> = ${JSON.stringify(sorted, null, 2)};
`;

  writeFileSync(OUT_PATH, content);
  console.log(`Wrote ${Object.keys(sorted).length} Lithuanian names to ${OUT_PATH}`);
}

main().catch((e) => {
  console.error('Lithuanian ECO data generation failed:', e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `mychess/package.json`, directly after the existing `"eco:generate"` line, add:

```json
    "eco:generate:lt": "tsx scripts/generate-eco-data-lt.ts",
```

- [ ] **Step 3: Run the generator**

Run: `npm run eco:generate:lt`
Expected: a progress line ending `E9:10`, then `Wrote 500 Lithuanian names to src/lib/openings/eco-data-lt.ts`.

If any decade throws "yielded no names", stop and re-check the markup against Task 1's fixture rather than weakening the parser.

- [ ] **Step 4: Sanity-check the output**

Run:
```bash
grep -c '":' src/lib/openings/eco-data-lt.ts
grep -E '"(A00|B90|C60|E60)":' src/lib/openings/eco-data-lt.ts
```
Expected: a count of 500, and these four lines:
```
  "A00": "Nepopuliarūs debiutai",
  "B90": "Siciliška gynyba, Naidorfo variantas",
  "C60": "Ispaniška partija",
  "E60": "Karaliaus Indiška gynyba",
```

- [ ] **Step 5: Commit**

```bash
git add mychess/scripts/generate-eco-data-lt.ts mychess/src/lib/openings/eco-data-lt.ts mychess/package.json
git commit -m "feat(openings): generate Lithuanian ECO names from šachmatai.lt (GitHub issue #158)"
```

---

### Task 3: The locale-aware name helper

**Files:**
- Create: `mychess/src/lib/openings/name.ts`
- Create: `mychess/src/lib/openings/name.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mychess/src/lib/openings/name.test.ts`. The table is an injectable argument so the test never depends on the 500-entry generated file — the same shape `detectOpening(sanMoves, openings)` already uses in `classify.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { localizedOpeningName } from './name';

const NAMES_LT = { B90: 'Siciliška gynyba, Naidorfo variantas' };

describe('localizedOpeningName', () => {
  it('returns the Lithuanian name under the lt locale', () => {
    expect(
      localizedOpeningName({ code: 'B90', englishName: 'Sicilian Defense: Najdorf Variation', locale: 'lt', namesLt: NAMES_LT })
    ).toBe('Siciliška gynyba, Naidorfo variantas');
  });

  it('returns the English name under any other locale', () => {
    expect(
      localizedOpeningName({ code: 'B90', englishName: 'Sicilian Defense: Najdorf Variation', locale: 'en', namesLt: NAMES_LT })
    ).toBe('Sicilian Defense: Najdorf Variation');
  });

  it('falls back to English when lt has no entry for the code', () => {
    expect(
      localizedOpeningName({ code: 'Z99', englishName: 'Some Future Opening', locale: 'lt', namesLt: NAMES_LT })
    ).toBe('Some Future Opening');
  });

  it('returns null when there is no code', () => {
    expect(localizedOpeningName({ code: null, englishName: null, locale: 'lt', namesLt: NAMES_LT })).toBeNull();
  });

  it('returns the Lithuanian name even when no English name was stored', () => {
    expect(localizedOpeningName({ code: 'B90', englishName: null, locale: 'lt', namesLt: NAMES_LT })).toBe(
      'Siciliška gynyba, Naidorfo variantas'
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/openings/name.test.ts`
Expected: FAIL — `Failed to resolve import "./name"`.

- [ ] **Step 3: Write the helper**

Create `mychess/src/lib/openings/name.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/openings/name.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/openings/name.ts mychess/src/lib/openings/name.test.ts
git commit -m "feat(openings): locale-aware opening name helper (GitHub issue #158)"
```

---

### Task 4: Coverage guard

The one test that protects this over time: `eco:generate` and `eco:generate:lt` are separate commands, so regenerating English data can introduce codes Lithuanian has never seen.

**Files:**
- Create: `mychess/src/lib/openings/eco-coverage.test.ts`

- [ ] **Step 1: Write the test**

Create `mychess/src/lib/openings/eco-coverage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ECO_OPENINGS } from './eco-data';
import { ECO_NAMES_LT } from './eco-data-lt';

describe('Lithuanian ECO coverage', () => {
  it('names every code that the English data carries', () => {
    const missing = ECO_OPENINGS.map((o) => o.code).filter((code) => !(code in ECO_NAMES_LT));
    // A non-empty list means `eco:generate` introduced codes that
    // `eco:generate:lt` has not been re-run for. Those codes fall back to
    // English rather than rendering blank, so this is a prompt to regenerate,
    // not a production outage.
    expect(missing).toEqual([]);
  });

  it('carries no Lithuanian name for a code the English data does not have', () => {
    const codes = new Set(ECO_OPENINGS.map((o) => o.code));
    expect(Object.keys(ECO_NAMES_LT).filter((code) => !codes.has(code))).toEqual([]);
  });

  it('has no blank names', () => {
    expect(Object.entries(ECO_NAMES_LT).filter(([, name]) => name.trim() === '')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run src/lib/openings/eco-coverage.test.ts`
Expected: PASS, 3 tests. If the first fails, re-run `npm run eco:generate:lt` rather than editing the generated file.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/lib/openings/eco-coverage.test.ts
git commit -m "test(openings): fail when Lithuanian ECO names stop covering the English data (GitHub issue #158)"
```

---

### Task 5: Wire the three render sites

**Files:**
- Modify: `mychess/src/lib/components/OpeningPicker.svelte:85`
- Modify: `mychess/src/routes/(player)/repertoires/+page.svelte:38`
- Modify: `mychess/src/routes/(coach)/coach/repertoires/+page.svelte:88-89`

- [ ] **Step 1: Update the picker**

In `mychess/src/lib/components/OpeningPicker.svelte`, add to the imports at the top of `<script>`:

```ts
  import { getLocale } from '$lib/paraglide/runtime';
  import { localizedOpeningName } from '$lib/openings/name';
```

Replace the visible label (currently `<span class="text-(--color-text)"> — {opening.name}</span>`) with:

```svelte
                <span class="text-(--color-text)">
                  — {localizedOpeningName({ code: opening.code, englishName: opening.name, locale: getLocale() })}
                </span>
```

Leave the hidden `<input name="eco_name" value={opening.name} />` exactly as it is: the stored value stays English by design.

- [ ] **Step 2: Update the player repertoire list**

In `mychess/src/routes/(player)/repertoires/+page.svelte`, add to the imports:

```ts
  import { getLocale } from '$lib/paraglide/runtime';
  import { localizedOpeningName } from '$lib/openings/name';
```

Replace line 38:

```svelte
                  <p class="text-xs text-indigo-500">{rep.eco_code} — {localizedOpeningName({ code: rep.eco_code, englishName: rep.eco_name, locale: getLocale() })}</p>
```

- [ ] **Step 3: Update the coach repertoire list**

In `mychess/src/routes/(coach)/coach/repertoires/+page.svelte`, add the same two imports, then replace the `eco_name` span (line 89):

```svelte
                    <span class="text-(--color-muted)"> — {localizedOpeningName({ code: rep.eco_code, englishName: rep.eco_name, locale: getLocale() })}</span>
```

- [ ] **Step 4: Run the full check**

Run, from `mychess/`:
```bash
npm run check
npm run lint
npm test
```
Expected: `check` 0 errors, `lint` 0 errors, and the whole suite green with 12 new tests (4 + 5 + 3).

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/components/OpeningPicker.svelte "mychess/src/routes/(player)/repertoires/+page.svelte" "mychess/src/routes/(coach)/coach/repertoires/+page.svelte"
git commit -m "feat(openings): show Lithuanian opening names under the lt locale (GitHub issue #158)"
```

---

### Task 6: Document the new command

**Files:**
- Modify: `mychess/CLAUDE.md` (the Commands section)

- [ ] **Step 1: Add the command**

In `mychess/CLAUDE.md`, directly after the existing `npm run eco:generate` bullet, add:

```markdown
- `npm run eco:generate:lt` — regenerates `src/lib/openings/eco-data-lt.ts`, the Lithuanian name for every ECO code, by scraping šachmatai.lt's 50 decade pages (GitHub issue #158). Deliberately separate from `eco:generate`: that one reads lichess's TSVs, this one scrapes a third party's HTML, and a markup change there must not be able to break the English data. Names are stored verbatim, move disambiguation included. `src/lib/openings/eco-coverage.test.ts` fails if `eco:generate` ever introduces codes this has not been re-run for.
```

- [ ] **Step 2: Commit**

```bash
git add mychess/CLAUDE.md
git commit -m "docs: document eco:generate:lt (GitHub issue #158)"
```

---

## Manual verification

Automated tests cover the parser, the helper and coverage. These two need eyes:

- [ ] **Spot-check the generated names.** Read `src/lib/openings/eco-data-lt.ts` — 500 entries, and the maintainer reviews rather than writes them. Expect 381 distinct names (12 codes read `Siciliška gynyba`) and 159 carrying move notation.
- [ ] **Switch locale in the running app.** `npm run dev`, then with `lt` active confirm the opening picker and both repertoire lists show Lithuanian names, and English under `en`. The picker renders `{code} — {name}`, so duplicate Lithuanian names stay distinguishable by code.

## Before shipping

- [x] **Permission to use šachmatai.lt's names — settled 2026-09-09.** The maintainer's call: chess opening names are public information, so no permission is sought. The generator and generated file credit the site anyway. See the spec's "Resolved: permission to redistribute".
