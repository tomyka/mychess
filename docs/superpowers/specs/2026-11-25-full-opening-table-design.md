# Chapter names from every named Lichess line (#377, R-216)

## Problem

`packages/chess/scripts/generate-eco.mjs` keeps one entry per ECO code
(`oneEntryPerCode`): 500 of the ~3,870 named lines in
lichess-org/chess-openings. A chapter is classified against that reduced
table and its English name is its code's single representative, so the M1
persona testers saw (#326):

| Line | Shown today | Right name (full table) |
| --- | --- | --- |
| 1.d4 Nf6 2.c4 e6 3.g3 d5 4.Bg2 Be7 5.Nf3 O-O 6.O-O dxc4 | Catalan Opening: Closed (E06) | Catalan Opening: Open Defense, Classical Line (E05), by transposition |
| 1.e4 c6 2.d4 d5 3.e5 | Caro-Kann Defense (B12) | Caro-Kann Defense: Advance Variation (B12) |
| 1.e4 c5 2.d4 cxd4 3.c3 | Sicilian Defense: McDonnell Attack (B21) | Sicilian Defense: Smith-Morra Gambit (B21) |

## Rulings

- R-216: classify against every named line, position-keyed; English name is
  the deepest matched line's; Lithuanian stays per ECO code (šachmatai.lt)
  until the Lithuanian work returns (R-179).
- Owner, 2026-11-25: names are **derived when titles are built**, not stored.
  A chapter's stored `{ kind: 'eco', eco }` keeps meaning "named by the
  taxonomy"; nothing new is persisted, no migration, no backfill.

## Design

### 1. The table (`packages/chess/src/openings/data/eco.json`)

The generator keeps **every** row of the five TSV volumes, and writes each
entry's final position key next to its code, name and moves:
`{ code, name, moves, key }`. Computing keys at build time keeps module load
to a `Map` build (no 3,870-line chess.js replay at server start). A unit test
replays every entry and checks its stored key, so broken data still fails in
the gate, now at test time rather than at startup.

When two rows reach the same position the later row wins, as today.

`eco-tsv.ts` loses `oneEntryPerCode`; the per-code fallback below replaces it.

The table stays server-only: no client module imports `classify`, and the
plan checks the built client bundle holds none of its names.

### 2. Classification (`packages/chess/src/openings/classify.ts`)

- `classify(sans)` keeps its contract (deepest named position along a line
  from the start, repetitions not counted again) over the full table.
- New `classifyChapter(graph, chapter)`: the same answer for a chapter's
  main line, read from the graph's position keys (each move's `from`, plus
  one chess.js move for the last move's result) instead of replaying the
  line, so titling a 200-chapter repertoire stays cheap. Null for a chapter
  not rooted at the start.
- `openingName(entry, locale)`: English `entry.name`; Lithuanian
  `ECO_LT[entry.code]`, English when it has none.
- `ecoName(code, locale)` stays as the fallback for a taxonomy-named chapter
  whose main line no longer classifies: its code's shortest line (today's
  family name), or the code itself.

### 3. Chapter titles

One chess function, `taxonomyNames(graph, locale)`: each taxonomy-named
chapter's id to its derived name (classification, else `ecoName` of the
stored code). Every place that titles chapters uses it:

- `apps/web/src/server/chapter-names.ts`: `chapterLabelIn` and
  `chapterNamesOf` build titles from it; `ChapterNames.ecoNames` (keyed by
  code) becomes `taxonomyNames` keyed by chapter id, and
  `apps/web/src/lib/chapter-label.ts`'s `baseTitle` takes a per-chapter
  lookup instead of a per-code one.
- PGN download and data export: the title function also receives the graph
  (`exportPgn` and `account-export.ts` already hold it), so the plain name
  is derived the same way.

### 4. R-158 distinctions

`chapterDistinctions` takes the ECO code from the classification, falling
back to the stored code. Titles are compared after naming, so chapters that
used to share a family name and now have different names (two B12
chapters, the Advance Variation and the 3.Nd2 main line) no longer get a "(B12, 3. e5)" suffix; chapters that still
share a name keep it.

### 5. Naming on import and edit (R-63, R-104)

Unchanged behaviour: `taxonomyNamed` and `namedByMoves` still store
`{ kind: 'eco', eco: entry.code }` from the full-table classification. A
custom or header name is never replaced.

## Out of scope

- Lithuanian names (wording, per-line names, the Rosolimo/Moscow LT name):
  paused by R-179, stays in #326.
- Letting the owner or a coach rename taxonomy lines.

## Acceptance (from #377)

- The three lines in the table, and the Moscow Variation (B51/B52, already right), get the right English names, through import,
  the builder, the repertoire page, the coach and import-preview views, and
  the PGN/data exports, covered by tests.
- A transposition into a named line gets that line's name.
- Lithuanian names are unchanged (same per-code names as before).
- Existing chapters show the new names with no data change.
- The opening table is not in the client bundle.
