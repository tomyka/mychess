# Mastery-Per-Variation Practice Redesign — PRD

## 1. Executive Summary

### Problem Statement

Practice mode's current progression model (`src/lib/mastery/levels.ts`) is breadth-first: every variation in a repertoire advances through the same uniform 3-move chunks in lockstep (`MOVES_PER_LEVEL = 3` — level *n* covers the player's own moves 1 through `3n`, across *all* variations at once). A player ends up shallowly familiar with every line in a repertoire before being solid on any single one of them. Separately, when a position allows more than one repertoire move, `alternativesAt` (`src/lib/mastery/practice.ts`) accepts any single valid reply and silently defers the others to a later, unlabeled queue slot — the player is never told "there are 2 correct replies here, find both," so playing a valid-but-unexpected move reads as arbitrary rather than as a signal that more is being asked of them.

### Proposed Solution

Redesign Practice mode around **mastery of one variation at a time**, teaching branch points explicitly instead of testing them by surprise:

1. **Depth-first, sequential unlocking**: variations in a repertoire are worked through one at a time (in chapter/PGN order); a variation must be mastered before the next one unlocks.
2. **Guided teach pass, then blind test pass**: the first time a position is reached, every repertoire-legal move there is shown as an arrow and the player plays each one. On later encounters, arrows are gone, but if a position has *K* valid replies, the player is told *K* is expected and is drilled on that node until all *K* have been reproduced from memory.
3. **Configurable depth per attempt, no full-length memorization required**: a practice attempt never demands more than a configurable number of the player's own moves in a row (default modest, e.g. 4-6) — a 20-move-deep prep line is never drilled start-to-finish in one go just to advance. The exact algorithm for how a variation's depth grows attempt-over-attempt is intentionally **not** fully specified in this PRD (see Non-Goals) — this PRD's scope is the teach/test loop and sequential focus, not a tuned leveling formula.
4. **Spaced review resurfacing**: once mastered, a variation is not simply "done" — it resurfaces later on a review schedule so it isn't forgotten while the player learns the next one.
5. **Repertoire outline side panel**: a read-only tree of the whole repertoire (grouped by chapter) sits alongside the board. The active variation is expanded with moves highlighted as they're solved; not-yet-unlocked variations are collapsed to a title and move-count only, so nothing is spoiled; mastered variations show fully, badged as mastered.

### Success Criteria

- **Depth concentration**: at any point in time, ≥90% of a player's in-progress practice time on a repertoire is spent on the single currently-unlocked variation (vs. today, where all variations are simultaneously "in progress" at the same shallow level).
- **Branch completeness**: ≥95% of multi-option nodes have all valid moves demonstrated by the player before that node is counted as taught (measured via node-level completion logging — new instrumentation, see Risks).
- **Mastery completion rate**: ≥80% of variations a player starts reach "mastered" status without the player abandoning the repertoire mid-variation (baseline currently unmeasured — requires the logging above before/after comparison isn't possible until this ships; track as the first cohort's own benchmark).
- **No forced long memorization**: no single practice attempt ever requires the player to replay more than the configured max depth in one unbroken run — depth grows in bounded chunks, never "the whole 20-move line or nothing."
- **Retention on review**: mastered variations resurfaced via spaced review are answered correctly on first attempt ≥85% of the time (aligned with common SRS retention targets).
- **No regression in existing chapter-picker flows**: `RepertoirePracticeRow.svelte`'s chapter selection (issue #58/#59) continues to work unmodified against the new progression model.

---

## 2. User Experience & Functionality

### User Personas

- **Self-directed player**: builds and drills their own repertoire solo, wants to *actually know* a smaller opening repertoire cold rather than have superficial exposure to a large one.
- **Coach-assigned student**: practices a repertoire assigned by a coach; coach-facing reporting (`docs/superpowers/specs/2026-08-11-coach-practice-reports-design.md`) should be able to distinguish "deep on 3 lines" from "shallow on 10 lines" once this ships — reporting changes themselves are out of scope here (see Non-Goals).

### User Stories

- As a player, when I reach a position for the first time in a variation, I want to see an arrow for every good move there so I learn the full branch without guessing blindly.
- As a player, when a position has more than one correct reply, I want to be told how many are expected so a "wrong" doesn't actually mean I played a move the repertoire itself allows.
- As a player, I want the app to stay on one variation until I've truly got it, instead of nudging every line forward by the same few moves each session.
- As a player, I want a say in how many moves I'm asked to chain together per attempt, so a long prep line doesn't force me to flawlessly replay 20+ moves in a row just to be allowed to move on.
- As a player, once I've mastered a variation, I want it to come back for review later so I don't quietly forget it while working on the next one.
- As a player, I want to see my whole repertoire's structure and progress at a glance, without the moves of variations I haven't reached yet being spoiled for me.

### Acceptance Criteria

- **Teach pass**: on the first visit to a position within the currently-active variation, the board renders an arrow (not just an origin-square hint) for every move `alternativesAt`-equivalent logic identifies as repertoire-legal there. The player must play each shown move at least once (order doesn't matter) before the app advances past that node for the teach pass.
- **Test pass**: on any subsequent visit to that same position (later in the same run-through, in a later run-through, or during spaced review), no arrows render. If the node has *K* valid replies, the UI communicates "N of K found" (or equivalent) and the node keeps resurfacing until all *K* have been reproduced since the last reset; a valid-but-not-yet-seen alternative is accepted as correct, not treated as a wrong answer.
- **Sequential unlocking**: a repertoire exposes exactly one variation as "active" at a time (chapter order, then existing PGN/variation order within chapter); all others are "locked" until the active one is mastered.
- **Bounded attempt depth**: no single practice attempt asks the player to chain more than a configurable max number of their own moves (a setting akin to the existing per-repertoire `practiceDepthLevels` cap) — a "clean" attempt is judged only over that bounded chunk, not the full variation length. Depth grows attempt-over-attempt as the player shows they've got the current chunk; the exact growth algorithm and mastery threshold are explicitly **not** locked down by this PRD (see Non-Goals) — ship the simplest version that respects the depth cap, and tune it from real usage.
- **Full-length mastery, eventually**: a variation still isn't "mastered" until the player has demonstrated the entire line, chunk by chunk — this PRD just refuses to specify *how many* clean passes or *how* chunks grow, deferring that tuning to implementation/playtesting.
- **Spaced review**: mastered variations are scheduled for resurfacing (interval mechanism TBD, see Technical Specifications) and appear back in the practice queue on their due date without blocking progress on the currently-active new variation.
- **Outline panel**: renders every chapter and variation in the repertoire. Locked variations show title + move count only (no moves). The active variation is expanded, each move visually marked solved/unsolved as the teach/test passes clear it. Mastered variations render fully with a "mastered" badge. The panel is read-only — clicking a move does not move the board (per product decision; navigation is a possible future enhancement, not this PRD).

### Non-Goals

- Click-to-navigate / replay-from-panel interaction (explicitly deferred; panel is read-only for this PRD).
- Engine-based move-quality feedback (Blunder/Mistake/Inaccuracy) — that's Drill mode's concern (`2026-07-13-drill-move-feedback-design.md`), not touched here.
- Master mode — already removed; this PRD does not resurrect a separate mode, it reshapes Practice mode itself.
- Cross-repertoire blending into one global daily queue — review scheduling stays scoped to a single repertoire, consistent with Practice mode's current single-repertoire focus.
- Reordering variations by frequency/difficulty/ECO data — sequential order is chapter-then-PGN-order for this PRD; smarter ordering is a future enhancement.
- Coach-report UI changes reflecting the new depth-vs-breadth data — flagged as a likely follow-up, not built here.
- **A fully specified leveling/mastery algorithm.** Deliberately dropped from this PRD's scope per explicit product direction: no fixed "N consecutive full clean run-throughs," no fixed level-depth table. The only hard requirement is the configurable attempt-depth cap (Acceptance Criteria above); how depth grows within that cap and what exactly counts as "mastered enough for the next variation" is left to implementation/playtesting, not fixed here. The priority for this PRD is the teach-pass/test-pass learning experience itself.

---

## 3. AI System Requirements

Not applicable — this feature has no LLM/AI component. (Existing Stockfish move-quality classification used elsewhere in the app, e.g. Drill mode, is out of scope per Non-Goals above.)

---

## 4. Technical Specifications

### Architecture Overview

Current relevant modules (from investigation of the live codebase):

| File | Current role | Change |
|---|---|---|
| `src/lib/mastery/levels.ts` | Uniform `MOVES_PER_LEVEL = 3` depth levels across all variations | Breadth-first-across-all-variations behavior dropped. Its existing `practiceDepthLevels`-style cap concept is repurposed as the one configurable knob this PRD requires: a max chunk depth applied to whichever single variation is active. No replacement leveling formula is specified here (see Non-Goals) |
| `src/lib/mastery/practice.ts` | `splitAttempt` (prefix/quiz split), `alternativesAt` (single-alternative acceptance) | `alternativesAt` extended into branch-exhaustive drill tracking (per-node "moves demonstrated" set); attempts gain a `clean` flag, bounded by the configurable chunk-depth cap |
| `src/lib/mastery/levelProgress.ts` | FIFO queue, demotion after 3 review-band mistakes, level-advance-on-clear | Its queue/demotion mechanics are the likely starting point for the bounded-chunk progression, but the exact state machine is an implementation decision, not fixed by this PRD |
| `src/lib/mastery/variations.ts` | `enumerateVariations`, chapter tagging | Reused as-is for both sequencing and the outline panel's data source |
| `src/routes/(player)/practice/[repertoire_id]/+page.svelte` | Board, hint-after-3-misses (origin square only), branch handling | Gains teach-pass/test-pass mode switching and drives the new outline panel |
| `src/lib/components/ChessBoard.svelte` (lines 24-37, 225-231) | Single-square 💡 hint rendering | Extended to render multiple move arrows for the teach pass |
| `src/lib/components/RepertoirePracticeRow.svelte` | Chapter-grouped picker (issues #58/#59) | Unchanged — picker still selects which variations are in-scope for the redesigned progression to sequence through |
| New: `RepertoireOutlinePanel.svelte` | — | New component rendering the read-only chapter/variation tree described above |

### Integration Points

- `/api/practice/{attempt,continue,mistake,move-log}`: attempt payloads need a `clean` flag and per-node branch-drill completion; a new endpoint (or extension) is needed to persist/query spaced-review due dates once mastered.
- Database: new column(s)/table for per-variation mastery state (`locked`/`active`/`mastered`/`due_at`) and per-node branch-drill progress. Exact schema is a follow-up design doc, not this PRD.
- No new external integrations.

### Security & Privacy

No new PII. All data is the practicing player's own progress, governed by existing repertoire/practice authorization — no change to the access model.

---

## 5. Risks & Roadmap

### Phased Rollout

- **MVP (v1)**: sequential unlocking, a configurable attempt-depth cap (bounded chunks, never the full line at once), teach-pass arrows, test-pass "K expected here" branch-exhaustive drilling. The chunk-growth/mastery algorithm ships as the simplest thing that respects the depth cap — not tuned yet. Mastered variations simply stop appearing (no review scheduling yet).
- **v1.1**: repertoire outline side panel (read-only, locked lines collapsed).
- **v2**: spaced review resurfacing for mastered variations — scheduler design (custom interval vs. adapting the FSRS approach referenced in `2026-07-08-repertoire-mastery-levels-design.md`) is an explicit open decision for that phase.

### Technical Risks

- **No existing instrumentation** for the success KPIs above (depth concentration, branch completeness, mastery completion rate) — lightweight event logging needs to be added before/alongside MVP so these are measurable, not just designed-for.
- **"Clean" needs a precise, testable definition** before implementation — in particular, whether a hint used during the *teach* pass (which is ungraded) should be allowed to still count toward a later clean attempt, vs. any hint at all resetting the streak.
- **Default chunk-depth size is an unvalidated guess.** Too small feels grindy (constant re-tests of the same few moves); too large recreates the original 40-move problem. Needs playtesting and should stay a per-repertoire setting the player can adjust, not a hardcoded constant.
- **Branch-drill UX at wide nodes**: a position with many repertoire-legal replies could make the test pass feel tedious (drilling the same node K times back-to-back). Needs a UX decision (immediate back-to-back vs. interleaved with continuing the line) during implementation, not fully specified by this PRD.
- **No live users yet** (per current project status) means no migration path is required off the existing breadth-first level data — this can ship as a clean replacement rather than a migration.
