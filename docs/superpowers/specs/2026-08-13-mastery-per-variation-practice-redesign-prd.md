# Mastery-Per-Variation Practice Redesign — PRD

> **Revision note (2026-08-13, second pass):** The first version of this PRD proposed a configurable-depth-chunk "leveling" compromise (see `docs/superpowers/plans/2026-08-13-variation-sequenced-practice-depth.md`, already shipped to `main`) so a long variation wouldn't need a full flawless replay to make progress. Having lived with that shipped foundation — sequential, one-active-variation-at-a-time drilling — the product direction is now: **drop leveling/chunking entirely.** A practice attempt is always the complete variation, start to finish. This revision supersedes every leveling-related section of the original PRD below; the sequential/active-variation architecture itself is kept and built on top of.

## 1. Executive Summary

### Problem Statement

Two things are true at once: (1) sequential, one-variation-at-a-time drilling (already shipped) is working well and should stay — the player likes the "continuity of the exercise." (2) The leveling/chunk-depth machinery layered under it (`src/lib/mastery/levels.ts`, most of `levelProgress.ts`) has no purpose anymore now that only one variation is ever active at a time — it was solving "don't force a 40-move replay," a problem that a full-replay-per-attempt model needs to solve differently, not via chunking. Separately, always forcing the *next* variation in PGN order — with no way to jump to a specific one — doesn't match how players actually study: a user reported wanting to drill one specific line on demand (prepping for an opponent, revisiting something they just blundered in a real game, etc.).

### Proposed Solution

1. **Keep sequential, one-active-variation drilling** exactly as shipped — this is the part the player explicitly wants preserved.
2. **Remove leveling entirely.** A practice attempt is always the full variation, move 1 to the last move, in one continuous replay — no chunked depth, no queue, no demotion, no "Level N of M."
3. **"Solved" = one clean full replay.** The instant a player replays a variation start-to-finish with zero mistakes, it's solved — permanently, no re-testing required to keep that status (matches the simplicity of "continuity of the exercise": one clean pass is the exercise, not a multi-stage gate).
4. **Progress becomes a single number: "M of N variations solved."** Replaces every "Level X of Y" display, repertoire-wide (not just the active variation).
5. **A variation picker returns to the practice page**, letting a player jump to and drill any specific variation on demand — hierarchy: **repertoire → chapter → variation**, with variations inside a chapter bucketed by their **top 5 most frequent first moves** (plus an "Other" bucket) so the list stays short even for a repertoire with dozens of variations sharing a chapter. Picking a variation makes it the new active one — the sequence continues from there next time, rather than this being a disconnected side mode.

### Success Criteria

- **Leveling fully removed**: no UI, code path, or persisted field describes progress in terms of "levels" once this ships — replaced everywhere by the solved/total count.
- **Every practice attempt is a full replay**: no attempt ever auto-plays a prefix or stops short of a variation's natural end (except being interrupted by a mistake, which ends that attempt as "not solved this time," not "partially credited").
- **Picker usability**: for a chapter with 20+ variations, the move-grouped picker never shows more than 6 top-level groups (5 named + "Other") before a variation is chosen.
- **Picking a variation is durable**: after picking variation V and leaving the page, returning to Practice resumes on V (it's now the active variation), not back to wherever the sequence would have naturally been.
- **No regression in existing chapter-picker flows**: `RepertoirePracticeRow.svelte`'s chapter include/exclude selection (issues #58/#59, on the `/practice` list page) is a distinct feature from this new in-page variation picker and continues to work unmodified.

---

## 2. User Experience & Functionality

### User Personas

- **Self-directed player**: builds and drills their own repertoire solo, wants to *actually know* a smaller opening repertoire cold rather than have superficial exposure to a large one. Also the persona who asked for on-demand variation selection ("I need to drill this one specific line right now").
- **Coach-assigned student**: practices a repertoire assigned by a coach. Coach-facing reporting is unaffected by this PRD (out of scope, see Non-Goals).

### User Stories

- As a player, I want the app to stay on one variation until I've truly got it, instead of nudging every line forward a little at a time.
- As a player, I want "solved" to mean I actually played the whole line correctly in one go — not a multi-step gate I have to decode.
- As a player, I want to see how many of my repertoire's variations I've actually solved, out of the total, so I have one honest number instead of a level counter that doesn't mean much to me.
- As a player, when I know I need to drill one specific variation right now (prepping for an opponent, fixing a line I just blundered in a real game), I want to jump straight to it instead of waiting for the sequence to reach it naturally.
- As a player, when I pick a specific variation to drill, I want that choice to stick — the next time I come back to Practice, it should still be what I'm working on, not reset to wherever the sequence "should" be.
- As a player, when a chapter has a lot of variations, I want them grouped so I'm not scrolling a huge flat list to find the one I want.

### Acceptance Criteria

- **Full-replay attempts**: every practice attempt auto-plays nothing and quizzes the player on their own moves from the variation's start to its natural end. There is no concept of a partial/chunked attempt.
- **Mistake handling**: a wrong move is marked wrong and the player retries that same move in place (existing UX — board doesn't reset, book move isn't revealed), same as today. However, an attempt containing ANY mistake does not count as a clean replay — reaching the end of such an attempt does not mark the variation solved. The player must complete one attempt start-to-finish with zero wrong moves to solve it.
- **Solved is permanent**: once a variation is marked solved, it stays solved — no expiry, no re-testing requirement, no demotion. (Spaced-review resurfacing of solved variations is explicitly a Non-Goal for this PRD, see below.)
- **Solved/total progress display**: the practice page shows "M of N variations solved" for the current repertoire, where N is every variation the player hasn't excluded (respecting `variation_practice_exclusions`), computed repertoire-wide — not scoped to just the active variation.
- **Sequential default, resumable**: with no manual pick, the app serves variations in the existing order (chapter, then PGN order within chapter), skipping already-solved ones, exactly as today's active-variation sequencing already does — just without any level concept layered on top.
- **Variation picker**: a control on the practice page opens a hierarchical picker: chapters as top-level groups (only for repertoires where chapter tags exist, per `hasChapterTags` — matches the existing picker's own gating), each chapter's variations bucketed by their first move into up to 5 named groups (the 5 most frequent first moves within that chapter) plus one "Other" group for everything else. Selecting a leaf variation immediately sets it as the active variation and starts drilling it.
- **Manual pick affects the one shared sequence**: picking a variation writes the SAME `active_variation_key` the automatic sequence already uses — there is only one active-variation concept, not a separate "manual practice" mode running alongside it. The solved/total count and the "what comes next automatically" order are both unaffected by which variation is currently active; picking just moves the pointer.
- **Solved variations remain pickable**: the picker doesn't hide already-solved variations — a player can deliberately re-drill something they've already solved (e.g., after a long break, or just for confidence). Re-drilling a solved variation doesn't un-solve it on a mistake, and doesn't need re-solving on a clean pass either — solved is permanent per the acceptance criterion above.

### Non-Goals

- **Spaced-review resurfacing of solved variations.** The original PRD's "review schedule" idea is explicitly deferred — not decided against, just not part of this pass. Today's maintenance-review UI/session (level-based) is being removed as part of the leveling cleanup; a *replacement* review mechanism for "solved" variations is future work, not specified here.
- **Teach-pass arrows / branch-exhaustive "K expected here" drilling.** Still a live idea from the original PRD's Chessbook-inspired vision, still unbuilt, still orthogonal to this pass — not addressed here.
- **Real-game-frequency data (chess.com/Lichess stats) for move grouping.** The picker's "top 5 moves" grouping uses only the frequency of first moves *within the imported PGN's own variations* for that chapter — no external stats lookup.
- **Reordering the automatic sequence itself** (e.g., by difficulty or ECO popularity) — the automatic order stays chapter-then-PGN-order; only manual picking lets a player deviate from it.
- **Coach-report UI changes.** Out of scope, same as the original PRD.
- **Any change to `RepertoirePracticeRow.svelte`'s chapter include/exclude picker** on the `/practice` list page (issues #58/#59) — that's a different feature (scoping which variations are in the pool at all) from this PRD's new in-page variation picker (choosing which in-pool variation is active right now).

---

## 3. AI System Requirements

Not applicable — no LLM/AI component.

---

## 4. Technical Specifications

### Architecture Overview

This is primarily a **removal**, with two small additions. Current relevant modules:

| File | Current role | Change |
|---|---|---|
| `src/lib/mastery/levels.ts` | Chunk-size-parameterized level depth math (`levelDepth`/`targetDepth`/`hasContentAtLevel`/`taskKey`/`levelTaskVariations`/`levelCap`) | **Deleted.** Nothing in the new model needs a "level" concept at all. |
| `src/lib/mastery/levelProgress.ts` | FIFO queue, 3-strikes demotion, level-advance, maintenance-review level picking | **Deleted**, except `repertoireShape`-style variation counting, which is replaced by a much simpler "count of variations, filtered by exclusions" helper with no chunk/level dependency. |
| `src/lib/mastery/variationSequence.ts` | `pickActiveVariation`, `nextVariation`, `advanceVariationIfMastered`, `variationSequenceProgress` | **Kept and simplified.** `advanceVariationIfMastered`'s "mastered" check (`row.level > cap`) is replaced by a simple "is this variation in the solved set" check. `variationSequenceProgress`'s "M of N" math becomes THE primary progress metric surfaced in the UI (previously a secondary field alongside level info) — same shape, promoted to first-class. A new `pickVariationByKey`-style function backs manual picking (trivial: look the key up, same validation `pickActiveVariation` already does for a stale key). |
| `src/lib/mastery/practice.ts` | `splitAttempt` (prefix/quiz split by level), `pickQueuedAttempt`/`pickReviewAttempt` (queue/level-based), `alternativesAt`/`continueFromBranch` (already dead code per issue #61) | **`splitAttempt`/`pickQueuedAttempt`/`pickReviewAttempt` deleted** — replaced by a trivial "the whole variation's path is the quiz, nothing auto-plays" helper. `Alternative`/`alternativesAt`/`continueFromBranch` **deleted outright**, formally closing out issue #61 rather than leaving them as dead code. `buildPracticeView` simplifies to: pick the active variation (or the given manual pick), return its full path as the attempt, plus the repertoire-wide solved/total count. |
| `src/lib/server/level-progress.ts` | Optimistic-concurrency read/write of `level`/`queue`/`prev_level_mistakes`/`active_variation_key` | **Rewritten**, much smaller: persists `active_variation_key` (still needs the same optimistic-concurrency care — the exact concurrent-write scenario from the original design doc still applies) and records a variation as solved (a simple, idempotent presence-insert — no read-modify-write race to guard, since "solved" only ever transitions false→true, never back). |
| `src/lib/components/LevelList.svelte` | Level-picker sidebar (review-by-level, current-level highlight) | **Deleted.** No longer any levels to list. |
| `src/routes/(player)/practice/[repertoire_id]/+page.svelte` | Level/maintenance-review UI, depth-edit control, leveled-up/leveled-down banners | Level/banner/depth-edit UI removed. Gains: solved/total display, and the new variation-picker component below. |
| New: `VariationPicker.svelte` | — | Repertoire → chapter → move-group → variation tree, as described in Acceptance Criteria. Reuses `enumerateVariations`'s chapter tagging (`chapterName`) and computes first-move frequency client- or server-side from the already-fetched variation list — no new data source. |

### Data model

Current schema has `repertoires.chunk_size` / `repertoires.practice_depth_levels` and `level_progress.level` / `.prev_level_mistakes` / `.queue` / `.version` — all leveling-specific. This PRD's technical follow-up plan should:

- Drop `chunk_size` and `practice_depth_levels` from `repertoires` (or leave the columns and just stop reading them, if a clean migration is judged not worth the risk at plan time — an explicit decision for the plan, not fixed here).
- Replace `level_progress`'s level/queue/demotion columns with a solved-set: a new table (matching the existing presence-based pattern already used by `variation_practice_exclusions` — presence of a row means "solved," absence means "not yet") keyed by `(player_id, repertoire_id, variation_key)`.
- Keep `active_variation_key` — either on a slimmed-down `level_progress` (rename it, since it no longer tracks levels) or its own dedicated table. Exact shape is a plan-time decision.
- `move_attempts.level` (a per-move attempt log column, powering coach reports) loses its meaning — either drop the column or repurpose it; flagged as a decision for the plan, not resolved here since it touches coach-reporting surface this PRD doesn't otherwise change.

### Integration Points

- `/api/practice/mistake` (previous-level-mistake demotion reporting) — **deleted**, no demotion concept anymore.
- `/api/practice/continue` — **deleted**, closing out issue #61's dead-code removal as part of this same pass rather than separately.
- `/api/practice/attempt` — simplified: reports whether the just-completed attempt was clean; on a clean attempt, marks the variation solved (idempotent) and advances the active variation to the next un-solved one in sequence.
- A new lightweight way to set `active_variation_key` directly from the picker (either a small dedicated endpoint, or reusing the attempt-completion path with a "just switch, don't play" variant) — exact shape is a plan-time decision.
- No new external integrations; no new PII.

### Security & Privacy

Unchanged from the original PRD — all data is the practicing player's own progress, governed by existing repertoire/practice authorization.

---

## 5. Risks & Roadmap

### Phased Rollout

- **MVP (this PRD)**: remove leveling entirely (code + schema), full-replay-only attempts, permanent solved flag, solved/total display, variation picker with chapter → top-5-move-group → variation hierarchy, manual pick sets the active variation.
- **Future**: spaced-review resurfacing of solved variations (replacement for the removed level-based maintenance review); teach-pass arrows / branch-exhaustive drilling (from the original PRD, still unbuilt); possibly exposing the picker's move-groups using real-game frequency data instead of in-PGN frequency.

### Technical Risks

- **This is a bigger removal than it looks.** Leveling touches a lot of surface area that was only just built (see `docs/superpowers/plans/2026-08-13-variation-sequenced-practice-depth.md`) — `levels.ts`, most of `levelProgress.ts`, `LevelList.svelte`, two API routes, and DB columns. The implementation plan for this PRD should expect a similarly-sized task list to that prior plan, not a small patch.
- **`move_attempts.level` and coach reporting**: removing the level concept touches a column coach-facing reports may read. Needs a concrete decision (drop vs. repurpose) at plan time, informed by actually checking what `docs/superpowers/specs/2026-08-11-coach-practice-reports-design.md`'s reports currently show.
- **"Top 5 most frequent first moves" tie-breaking is unspecified.** If 6+ distinct first moves are tied for 5th place by count, which 5 win? Needs a deterministic rule (e.g., stable order = order of first appearance in the enumerated variation list) decided at plan time.
- **No live users yet** (per current project status) means the DB schema changes here can be clean replacements/drops rather than data migrations — same as the prior plan's own note.
