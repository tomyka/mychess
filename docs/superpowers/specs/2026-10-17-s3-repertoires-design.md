# S3 Repertoires: design

Issue #253 (epic #250). Slice plan: `2026-10-16-m1-slices-plan.md`, row S3, as reshuffled by R-96.
Brainstormed with the owner on 2026-10-17.

## The rulings applied

| Ruling | What it means here |
| --- | --- |
| R-4 | Content comes from PGN import and the board builder in S3. The explorer and starter repertoires are M2 |
| R-19 | A repertoire has one side and chapters by opening. It is a position-keyed graph, so transpositions merge. A player may have several repertoires per side |
| R-21, R-102 | Move comments belong to the repertoire: they are exported, and a sharing coach sees them (S4). Personal notes are separate and always private |
| R-63 | A chapter's name comes from the šachmatai.lt taxonomy, otherwise the header rule, otherwise "Chapter N". The owner can rename it |
| R-64 | An upload imports every valid game and lists the skipped ones (game number, reason) before the user confirms. A file with no valid game is refused |
| R-65 | `[%cal]` and `[%csl]` arrows and circles are kept and shown when browsing |
| R-66 | A comment before a game's first move is the chapter intro. Limits: 2 MB, 200 games, variation depth 64 |
| R-79 | The main line follows the first move added at each position |
| R-96 | Sharing moves to S4. S3 adds PGN export |
| R-97 | The board is chessground (GPL-3.0) |
| R-101 | An upload creates a new repertoire or adds to an existing one of the same side. Added games become new chapters, and their positions merge |

## Lead decisions

- **Storage:** one row per move, not a JSON document. S5 assignments and S6 training state attach to individual moves (CLAUDE.md, R-29), so they need real foreign keys.
- **Editing:** load the graph, apply an S2 pure edit, and save the difference in one transaction. A `version` on the repertoire refuses a stale save, and the page asks the user to reload.
- **Removing a move** removes everything after it that is reachable only through it, after a confirmation. Positions reached another way stay.
- **Deleting a chapter** removes its moves that no other chapter uses.
- **No repertoire count limit in M1.** The free entitlement limits only coach use (R-70).

## Design

### Chess (`packages/chess`)

- `RepertoireMove` gains `comment: string | null`. `importPgn` keeps the comment after a move. Today it drops move comments; arrows, circles and intros are already kept. `exportPgn` writes the comments back. Exporting and then re-importing gives an identical graph, comments included (persona G-M1-6).
- `mergeInto(graph, imported)`: adds an imported graph's chapters and moves to an existing graph of the same side. Positions merge. A move that both graphs share keeps the existing graph's comment and marks unless it had none. Chapter ids stay unique.
- `editComment(graph, moveKey, text)`: a pure edit beside `setMarks`.
- `removeChapter(graph, chapterId)`: removes the chapter and the moves only it uses.

### Domain (`packages/domain`)

- `repertoireNameSchema` and `chapterNameSchema`: trimmed, never blank, at most 80 characters. Refusals are catalogue keys.
- `canViewRepertoire(viewer, repertoire)` and `canEditRepertoire(...)`: in S3 only the owner may do either. S4 adds viewing for a shared coach; S5 adds coach-owned repertoires and forks.
- `commentSchema` and `personalNoteSchema`: at most 2,000 characters.

### Database (`packages/db`)

- **Tables:**
  - `repertoires` (id, owner account, side, name, version, created and updated times).
  - `chapters` (id, repertoire, root position key, name source, intro, order).
  - `repertoire_moves` (repertoire, from key, san, to key, uci, arrows and circles as jsonb, comment, insertion order). Unique on repertoire, from key and san.
  - `move_chapters` (move, chapter).
  - `personal_notes` (player, repertoire, move key, text). Unique on player, repertoire and move key.
- **Every table cascades from its repertoire,** and every repertoire cascades from its account, so the S1 hard delete reaches them.
- **Repositories:**
  - `loadRepertoire` returns a `RepertoireGraph` plus its metadata, parsed with zod.
  - `saveRepertoireEdit(db, id, expectedVersion, before, after)` writes only the moves, chapters and comments that changed, and refuses a stale version.
  - `createRepertoire` and `importIntoRepertoire` run in one transaction.
  - `listRepertoires(owner)`, rename, delete, and personal-note upsert or delete.
- **The S1 data export** gains the account's repertoires as PGN, one per repertoire (R-40), plus its personal notes.

### Web (`apps/web`)

- **Board component:** wraps chessground. It supports tap-tap and drag, draws arrows and circles, flips for Black, and shows the last move. It is keyboard reachable, as `docs/design/` requires.
- **Pages:**
  - **"Mano repertuarai":** the list by side, and creating a repertoire (name and side).
  - **Repertoire page:** chapters with rename and delete, browsing on the board with the move list, comment, chapter intro and the player's personal note, and PGN export as a download route.
  - **Builder mode on the same page:** play a move on the board to add it, remove a move with a confirmation, draw arrows and circles, and edit the comment.
  - **PGN import:** upload, then a summary of lines, positions, transpositions and skipped games with reasons (R-64), then a choice of new repertoire or adding to an existing one of that side, then confirm.
- **Server actions** authenticate, load, call the domain or chess function that decides, and save.

## Testing

- **Chess:** unit and property tests for comment round-trips, `mergeInto` (transpositions, duplicate chapters, conflicting comments), `editComment` and `removeChapter`. Mutation testing applies.
- **Database:** load and save round-trips, and stale-version refusal. A cascade on account delete leaves no repertoire rows. An edit touches only the rows that changed.
- **Feature tests** (the #266 harness):
  - create, import (new and add), edit, delete;
  - an account sees only its own repertoires, and a foreign repertoire id is refused;
  - limits refuse an oversized upload, naming the limit.
- **E2E (Playwright):**
  - Rokas builds the London repertoire on a phone (U1-M1-5, own part);
  - Gabija imports the Taimanov PGN on desktop and sees the summary (G-M1-2) and exports it (G-M1-6);
  - both run in LT and EN.
- **Reviews:** ux-designer signs off the board and pages at 390px and 1280px, light and dark. i18n-content reviews the text.

## Done means

- Each persona's own repertoires can be imported or built on a phone and a desktop, in LT and EN.
- Exporting and re-importing gives an identical repertoire, comments included.
- An account can never read or change another account's repertoire (tests).
- The gate and CI are green, and the architect, qa, ux-designer and i18n-content have reviewed the slice.
