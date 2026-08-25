# MyChess

A chess-training platform: coaches build repertoires (openings), students learn and drill them via spaced repetition. Single context — the whole app.

## Language

**Repertoire**:
A position/move graph built from one PGN import. Owned by whoever uploaded it (`repertoires.player_id`), separately *assigned* to students (`assigned_repertoires`) — ownership and assignment are deliberately decoupled so a coach can build a personal library and assign the same repertoire to many students.

**Variation**:
One full line, root to leaf, enumerated from a repertoire's move graph. Identified by a `variationKey`.
_Avoid_: line (fine in prose, but "variation" is the identified, addressable unit).

**Chapter**:
A named grouping of variations within one PGN upload (from a multi-game or tagged PGN). A variation whose chapter is missing from a re-upload classifies as `removed` unless the coach chooses to keep that chapter.

**Learn**:
The teaching flow at `/learn/[repertoire_id]`: serves a variation in batches with arrows, then blind-retests the same batch, advancing until the whole variation is solved. Historically called "Practice" before #96 moved it here.
_Avoid_: Practice, drilling with arrows.

**Practice pool**:
The actual "Practice" mode at `/practice/[repertoire_id]`: a weakest-first quiz of already-*learned* variations, never an arrow. A wrong move or a hint demotes the line back to Learn.
_Avoid_: Practice (bare) — always qualify as "the Practice pool" to keep it distinct from Learn.

**Attempt**:
One pass through a variation in Learn — either a teach batch (arrows shown) or a blind retest (arrows gone) — ending either clean or with a mistake.

**Mastery** (the `src/lib/mastery/` folder):
Pure domain logic for teaching and variation-sequencing (teaching progress, playback, the drill state machines). Unrelated to the `/practice/[repertoire_id]/mastery` route, a per-chapter progress breakdown page.
_Avoid_: using "mastery" for the breakdown page — call that "the mastery run" or "the per-chapter breakdown" instead.

**Solved / learned**:
A variation that has passed one full, clean (mistake-free, hint-free) replay in Learn. Distinct from *mastered*, a ply-level counter (`masteredPlies`) tracking how far into a variation's moves the player has already proven themselves, which a solved variation's siblings can inherit as a shared prefix.

**Reconciliation**:
Carrying a student's existing progress forward after a coach re-uploads or reshapes a repertoire — matching each of the student's stale progress keys onto the new shape, so learning a variation isn't silently lost just because its move ids changed.
