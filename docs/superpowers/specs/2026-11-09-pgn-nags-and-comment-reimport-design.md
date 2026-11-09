# PGN NAGs and comment re-import

Issue #325 (M1 blocker, owner 2026-11-09, #258). Found by the persona tester Dovydas (D-M1-2).

## The rulings applied

- R-175: NAGs are kept on the move, shown as their symbols next to the move when browsing and learning, and written back in the PGN export.
- R-176: importing into an existing repertoire also adds the file's comments to moves that have none; an existing comment is never overwritten; the preview lists the comments it adds; a file that adds neither a move nor a comment is still refused (R-115, R-117).
- R-102: move comments belong to the repertoire, are exported, and a sharing coach sees them. R-65: `[%cal]`/`[%csl]` marks are kept as today.
- Q27: positions are keyed, so a move (and its comment and NAGs) is stored once per position and SAN.

## Lead decisions

1. **What a NAG is stored as:** the numbers, in file order without duplicates, on the move (`nags: readonly number[]`, `$1` to `$255`). The SAN suffixes `!`, `?`, `!!`, `??`, `!?`, `?!` in movetext are read as `$1` to `$6`.
2. **Which are shown:** the standard glyphs for move assessments `$1`-`$6` (! ? !! ?? !? ?!) and position assessments `$10` (=), `$13` (∞), `$14`-`$19` (⩲ ⩱ ± ∓ +- -+). Any other NAG is kept and exported but not shown. The glyph table lives in `@mychess/chess`; it is notation, not text, so it does not go through the message catalogues (same as SAN).
3. **Merging NAGs on import** follows R-176 for comments: a move with no NAGs takes the file's; a move that already has NAGs keeps them. (Lead reading of R-176 for the analogous annotation; the owner may change it.)
4. **Re-import and chapters:** a game that adds only comments or NAGs adds no chapter (R-117 stays about moves); its annotations land on the existing moves. The preview lists added comments (move and text) and added NAGs, alongside new moves.
5. **Change log:** an import that only adds comments or NAGs is recorded as a repertoire change like any other import (R-52 notifies players of a live repertoire), under the existing `commentsChanged` key; NAGs count as annotation changes there.
6. **Out of scope:** editing NAGs in the builder; NAG glyphs inside review prompts (review shows the board, not annotations); a NAG legend.

## Design

- **chess** (`packages/chess/src/pgn/tokenize.ts`, `replay.ts`, `import-pgn.ts`, `export-pgn.ts`, `repertoire/graph.ts`, `schema.ts`, `merge.ts`, a new `nags.ts` with the glyph table): tokens keep `$n` and suffix glyphs; replay attaches them to the move they follow; the graph move gains `nags`; merge applies decisions 3 and 4 and reports added comments and NAGs; export writes `$n` after the SAN. Round trip: import, export, import gives the same graph.
- **db** (`packages/db/src/schema.ts`, a generated migration, the repertoire repositories): `repertoire_moves.nags integer[] not null default '{}'`; read and write it with the move; the import-into-existing path writes added comments and NAGs.
- **web** (`apps/web`): the move list and the learn pass show the glyphs after the SAN; the import preview lists added comments and NAGs and enables Import when there are any.

## Testing

TDD per layer: tokenizer and replay keep NAGs and suffixes; merge adds to empty and never overwrites; export round trip with `persona-katalonu.pgn` (`$1`, `$14`); a db test that a comment-only re-import is accepted and a no-op file is refused; a web test that the preview lists added comments and the move list shows `!` and `⩲`.

## Done means

D-M1-2 passes: importing `persona-katalonu.pgn` shows its NAGs, and re-importing it into the seeded "Katalonų pradžia" adds the file's comments; the export carries both; the gate is green.
