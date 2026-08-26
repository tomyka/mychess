# Repertoire Knowledge Levels (Bronze/Silver/Gold/Platinum) — Design

> **Implementation-time amendment (2026-08-26):** while the implementation plan for this design was being written, a separate, already-merged commit (`feat(mastery): show Mastered on the repertoire list`, closing issue #105) landed on `main`. It added a `repertoires.chapter_count` cache and a cheap "Mastered" comparison on the repertoire *list* against this player's `chapter_mastery` row count — built entirely on the table this design retires. The retirement is extended to cover it: a new presence-based cache, originally named `chapter_platinum(player_id, repertoire_id, chapter_name)` and since renamed `chapter_completed` (see the next amendment), replaces `chapter_mastery` as that comparison's input (written at attempt-completion, cleared only by reconciliation — deliberately sticky, mirroring `chapter_mastery`'s own original policy). `chapter_count` itself is repertoire-wide and tier-agnostic, and is reused unchanged. This does not change any decision in the body below; see the implementation plan's own header note for the full mechanics.
>
> **Post-implementation amendment (2026-08-26):** a final holistic review across the completed implementation found two real gaps this design's body doesn't reflect, both now fixed (implementation plan Task 10): (1) the claim below that `deriveChapterLevel` needs no exclusion parameter because an excluded variation "simply can never appear in `solvedKeys`... for free" only holds if the excluded variation is still present in the array passed in — every real call site was loading a pre-filtered variation set that removed excluded variations entirely, silently defeating the "exclusions block advancement" requirement. Fixed by switching every chapter/tier computation to the unfiltered variation set (exclusions still counted as unsolved, not absent). (2) "Mastered" as literally "every chapter reads `'platinum'`" made it unreachable for any repertoire with a chapter short enough to have a lower ceiling (per this design's own vacuous-ceiling rule) — a real regression versus the old mechanic, which any chapter could earn regardless of depth. Per explicit product decision, "mastered"/"complete" is redefined throughout this document (and in `deriveRepertoireStatus`'s `platinumChapters` parameter, now `completedChapters`) to mean a chapter has reached its own ceiling — the highest tier it has any content in — not literally Platinum. Everywhere below that says a chapter must be "at Platinum" to count as mastered should be read as "at its own ceiling." Separately (documentation-only, no behavior change): §2's Acceptance Criteria still describes reordering `variationSequence.ts`'s automatic sequence by tier (Proposed Solution #4) — this was deliberately dropped during planning, after reading the actual Learn/Practice architecture and per the user's own clarification that the hint-based Learning phase should be left untouched; only the no-hints Practice criterion (a clean pass) ever governed the ladder, never sequencing.

## 1. Executive Summary

### Problem Statement

Repertoires today have only two independent progress signals: a flat, repertoire-wide "learned" status (every non-excluded variation individually solved) and a stricter "mastered" status gated on `chapter_mastery` — one continuous, mistake-free run through a whole chapter's already-solved variations in one sitting. Neither gives a player or coach a sense of *how deep* into a line they've actually proven themselves — a 6-move trap and a 30-move main line count identically toward "learned."

The user wants a graduated medal ladder per repertoire — Bronze/Silver/Gold/Platinum — keyed on how many of the player's own moves a variation runs, so depth of preparation becomes visible and progression feels sequential without changing what a player can actually practice on demand.

**Important context:** this repo has already built and fully removed three prior move-depth-tiering systems (`variation_progress.deepest_depth_reached`, the `move_progress`/`level_progress` gauntlet with 3-strikes demotion, and `chunk_size`/`practice_depth_levels`), each time because forced sequential depth-gating didn't match how players study and added machinery a full-replay-per-attempt model didn't need. This design is deliberately scoped to avoid resurrecting that: the variation picker's "any variation, on demand" guarantee is preserved untouched; the medal ladder is a **derived, read-only classification** of already-existing progress, not a new gate on what's practiceable.

### Proposed Solution

1. Bucket every variation into a tier by `playerMoveCount` (already computed, no schema change): **Bronze 1–9, Silver 10–18, Gold 19–27, Platinum 28+.**
2. Compute a **cumulative ladder per chapter**: a chapter's level is the highest tier T such that every variation in tiers ≤T is individually solved (the existing hint-free, mistake-free clean-pass bar — `variation_solved`). Reaching Silver requires Bronze *and* Silver variations solved, not Silver alone.
3. A repertoire's displayed level is the **minimum tier across its chapters**.
4. The **automatic** practice sequence (no manual pick) serves the lowest incomplete tier's unsolved variations first, within the existing chapter-then-PGN-order traversal. The **variation picker is untouched** — a player can still solve any variation, in any chapter, at any tier, at any time; it just doesn't count as "the medal" until lower tiers catch up.
5. **Retire `chapter_mastery`/`masteryRun.ts` entirely.** Reaching Platinum on a chapter (every tier solved) becomes the new "chapter mastered" bar, replacing the continuous-run mechanic.
6. The existing flat **"learned"** status (all non-excluded variations solved, repertoire-wide) is untouched and stays independent of the tier ladder.

### Success Criteria

- A repertoire/chapter's medal is visible and matches: highest tier where all variations at or below that tier are solved.
- A chapter with no variations in a given tier bracket doesn't block progress at that tier (vacuously cleared).
- Excluding a never-solved variation permanently caps its chapter (and, via the minimum rule, potentially the whole repertoire) below that variation's tier, until un-excluded and solved. A variation solved *before* being excluded does not cap anything.
- The variation picker's existing "pick any variation on demand" behavior has zero regressions — no variation becomes unpickable or unpracticeable because of tier state.
- A coach re-upload that reconciliation only partially demotes (per the existing granular `unchanged`/`extended`/`truncated` vs `diverged`/`removed` logic) results in medals being recomputed from whatever `variation_solved` rows survive — no blanket reset of unrelated chapters.
- `chapter_mastery` table, `masteryRun.ts`, and any UI entry point for the old "start mastery run" flow are removed with no dangling references.
- `first_repertoire_mastered` / `repertoires_mastered_5` badges keep their ids and continue to reflect "fully mastered," now defined as platinum on every chapter.

---

## 2. User Experience & Functionality

### User Stories

- As a player, I want to see how deep into my repertoire I've actually proven myself, not just a binary "learned" flag.
- As a player, I want medals to feel like real progression (bronze → silver → gold → platinum), without losing the ability to jump straight to any specific line I want to drill right now.
- As a player, if I deliberately exclude a line I don't want to study, I understand that chapter (and possibly the repertoire's displayed level) won't advance past that line's tier until I include and solve it.
- As a coach, if I edit a repertoire, I expect only the parts of it that actually changed to affect a student's medals — not an unrelated chapter's progress.

### Acceptance Criteria

- **Tier boundaries**: a variation's tier is determined solely by its `playerMoveCount` (the studied side's own move count, already computed by `enumerateVariations`): 1–9 Bronze, 10–18 Silver, 19–27 Gold, 28+ Platinum.
- **Cumulative per-chapter ladder**: a chapter's level is the highest tier T where every variation with tier ≤ T has a `variation_solved` row. Solving only Gold-tier lines while a Bronze-tier line in the same chapter is unsolved does not grant Gold (or Bronze, or Silver) — it's banked progress credited automatically once the lower tiers finish.
- **Vacuous tiers**: if a chapter has zero variations in a tier's bracket, that tier does not block the ladder — the next non-empty tier (or "fully complete" if none remain) is reachable.
- **Repertoire level = min across chapters.** A chapterless repertoire is treated as one implicit chapter (matches the existing `UNTAGGED_CHAPTER` handling in `variations.ts`).
- **No change to practiceability**: the variation picker (`VariationPicker.svelte`) continues to let a player select and drill any variation regardless of its tier or the chapter's current medal. Only the *automatic*, no-manual-pick sequence (`nextVariation` in `variationSequence.ts`) is reordered to prefer the lowest incomplete tier's unsolved variations first, within each chapter's existing position in the chapter-then-PGN-order traversal.
- **Exclusions block, don't skip**: unlike the existing "learned" status (which excludes excluded variations from its requirement entirely), the tier ladder requires an excluded variation's solved row to exist just like any other — since an excluded variation cannot be practiced, this permanently caps the chapter's (and via the minimum rule, potentially the repertoire's) level below that variation's tier until it's un-excluded and solved. A variation solved before exclusion satisfies the ladder even while excluded (its `variation_solved` row is untouched by exclusion).
- **Coach re-upload / reconciliation**: no new reconciliation logic. The existing granular reconciliation (`repertoire-reconcile.ts`) already decides per-variation whether a `variation_solved` row survives (`unchanged`/`extended`/`truncated` keep it; `diverged`/`removed` demote it). Medals are simply re-derived from whatever survives on the player's next load — an edit to one chapter cannot regress a different, untouched chapter's medal.
- **`chapter_mastery` retirement**: the table, `masteryRun.ts`, and any UI trigger for "start a mastery run" are deleted. `deriveRepertoireStatus()`'s `mastered` branch is redefined to mean "every chapter's derived level is platinum," keeping its existing boolean contract so downstream badge/report code needs no changes beyond the data source swap.
- **"Learned" unaffected**: the existing flat, repertoire-wide learned status (all non-excluded variations solved) keeps its current computation and exclusion semantics untouched — it is a separate, coarser signal that coexists with the tier ladder.
- **Badges**: `first_repertoire_mastered` and `repertoires_mastered_5` (`src/lib/badges/recalc.ts`) keep their ids and remain in `REVOCABLE_BADGE_IDS`; their underlying stat (via `countRepertoireStatuses()`) reflects the redefined `mastered` criterion. No new badge ids are added for bronze/silver/gold in this pass — the medal display itself is the signal; new milestone badges are an easy, separable follow-up if wanted later.

### Non-Goals

- Any change to what a player can practice or when (the picker, exclusions, and demotion-on-mistake behavior are all unchanged).
- New badges for bronze/silver/gold tiers (explicitly deferred, per above).
- Any change to the "learned" status's computation or exclusion handling.
- Any change to the teaching/hint phase (`variation_teaching_progress`, `teaching.ts`) — the tier ladder only consumes the existing hint-free `variation_solved` signal, it doesn't touch how teaching/hints work.
- Coach-report UI changes beyond whatever naturally falls out of the `mastered` stat's redefinition (no new report cards are being designed here).
- Caching/storing tier state — it is derived at read time from `enumerateVariations()` and `variation_solved`, exactly like `deriveRepertoireStatus()` and the (now-retired) `chapter_mastery` currency check, so a coach edit "just" changes the inputs with nothing to invalidate.

---

## 3. Technical Specifications

### Architecture Overview

This is primarily a new pure-derivation module plus one data-source swap inside an existing function, with a clean deletion of the mastery-run subsystem it replaces.

| File | Change |
|---|---|
| `src/lib/mastery/chapterLevels.ts` (new) | `tierForMoveCount(playerMoveCount): Tier` (boundary map); `deriveChapterLevel(variations: Variation[], solvedKeys: Set<string>): Tier \| null` (cumulative ladder, no exclusion parameter — see below); `deriveRepertoireLevel(chapterLevels: (Tier \| null)[]): Tier \| null` (minimum, treating `null` as lowest). Built on the existing `chapterTiers()`/`enumerateVariationsScoped()` grouping in `variations.ts` — no new enumeration logic. |
| `src/lib/mastery/repertoireStatus.ts` | `deriveRepertoireStatus()`'s `mastered` branch changes its data source: instead of checking `chapter_mastery` currency per chapter, it checks `deriveChapterLevel(...) === 'platinum'` for every chapter. Same return contract (`'learning' \| 'learned' \| 'mastered'`); `learned` branch is untouched. |
| `src/lib/mastery/variationSequence.ts` | `nextVariation` sorts a chapter's unsolved candidates by tier ascending (bronze-tier unsolved before silver-tier unsolved, etc.) before applying today's existing PGN-order tiebreak. `pickActiveVariation`/manual pick path (`pickVariationByKey`) unchanged. |
| `src/lib/mastery/masteryRun.ts` | **Deleted.** |
| `src/lib/server/repertoire-progress.ts` | Summary gains `chapterLevels: {chapterName, level}[]` and `repertoireLevel` fields, computed alongside the existing status derivation from the same already-fetched `moves`/`variation_solved` data — no new queries. |
| `src/lib/badges/recalc.ts` / `grant.ts` | No code change — `countRepertoireStatuses()` already reads `deriveRepertoireStatus()`'s `mastered` boolean, which now means something new but is structurally identical. |
| Coach re-upload / reconciliation (`repertoire-reconcile.ts`, `repertoire-progress.ts:660-677`) | No code change — reconciliation already recomputes summaries and reruns `grantNewBadges` when it demotes anything; that now also correctly regresses medals as a side effect of the `mastered` redefinition. |
| DB migration (new, next sequential number) | `drop table chapter_mastery` (clean drop — no live users, matching the precedent set by `0045_remove_leveling_add_solved.sql` and `0047_drop_move_progress.sql`). |
| UI: repertoire card / practice page | Add medal display (chapter-level and repertoire-level). Remove any "start mastery run" entry point tied to the deleted flow. Exact visual treatment deferred to implementation — not a blocking design decision. |

### Why `deriveChapterLevel` needs no exclusion parameter

The "exclusions block advancement" behavior falls out for free: an excluded variation cannot be practiced, so it can never gain a `variation_solved` row while excluded — which is exactly what caps the ladder. If it was solved *before* being excluded, its row persists untouched by exclusion, so it doesn't block. No special-casing is needed inside `deriveChapterLevel` itself; it simply checks "does every variation at or below tier T have a solved row," full stop. This is a different (and intentionally stricter) exclusion semantic than the existing "learned" status, which explicitly removes excluded variations from its requirement — the two functions do not share exclusion-filtering logic.

### Data Model

No new tables or columns. Tier and chapter/repertoire level are computed at read time from:
- `enumerateVariations()` / `enumerateVariationsScoped()` (existing, `src/lib/mastery/variations.ts`) — gives `playerMoveCount` and `chapterNames` per variation.
- `variation_solved` (existing) — the solved-set.

One migration: drop `chapter_mastery`.

### Integration Points

- `repertoire-progress.ts`'s summary-building path is the single place that computes both today's status and the new level fields — no duplicate derivation logic elsewhere.
- The reconciliation badge-recheck hook (`repertoire-progress.ts:660-677`) requires no changes; it already fires exactly when a repertoire's derived status can drop outside the player's own actions, which now includes medal regression.
- `/api/practice/attempt`'s existing "mark solved, advance active variation" flow requires no changes to its solved-marking logic — only `nextVariation`'s ordering, as noted above.

### Security & Privacy

Unchanged — all data is the practicing player's own progress, under existing repertoire/practice authorization. No new PII, no new external integrations.

### Testing

- **`chapterLevels.ts` unit tests**: boundary values (9 vs 10, 18 vs 19, 27 vs 28 `playerMoveCount`); cumulative-ladder correctness (silver requires bronze-tier variations solved too, not just silver-tier ones); vacuous-tier handling (a chapter with no variations past move 18 can still reach the ceiling tier it has content for); exclusion-blocks-only-when-never-solved (an excluded-but-previously-solved variation doesn't cap; an excluded-and-never-solved one does).
- **Integration**: `deriveRepertoireStatus()`'s `mastered` branch reflects platinum-on-every-chapter; badge grant/revoke fires correctly off the redefined stat; a reconciliation test confirms an edit to chapter A doesn't regress chapter B's level; an auto-sequence test confirms `nextVariation` serves lowest-incomplete-tier variations first while the picker's direct-selection path is unaffected by tier state.
- **Migration test**: confirm no remaining `from('chapter_mastery')`/`masteryRun` references after deletion (mirrors the grep-based verification already used in prior "drop dead schema" migrations).

---

## 4. Risks & Roadmap

### Phased Rollout

- **MVP (this design)**: tier derivation module, `mastered` redefinition, auto-sequence reordering, `chapter_mastery`/`masteryRun.ts` removal, medal display on repertoire/practice UI.
- **Future (explicitly deferred, not decided against)**: bronze/silver/gold catalog badges (`first_repertoire_bronze`, etc.) for symmetry with existing "first_repertoire_learned"-style celebrations; showing per-chapter medal breakdown inside the variation picker itself; coach-report surfacing of tier distribution across a coach's students.

### Technical Risks

- **Migration history vs. live schema drift**: per this repo's own `CLAUDE.md` convention, always verify `chapter_mastery`'s actual live shape via `information_schema.columns` before writing the drop migration, rather than trusting migration file history alone.
- **`nextVariation` reordering touches a shared, actively-used sequencing function** — needs care to avoid regressing today's "sequential default, resumable" behavior (`variationSequenceProgress`) for repertoires where tiering doesn't meaningfully change anything (e.g., every variation in the same tier).
- **UI scope**: exactly how medals are visually presented (icons, repertoire card vs. practice page vs. both) is left to implementation-time judgment / a follow-up visual pass — not fixed by this design, to avoid over-specifying before seeing it in context.
