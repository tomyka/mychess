# Tier-Gated Learn — Design

GitHub issue: #163. Follow-up to, and a deliberate partial reversal of, `docs/superpowers/specs/2026-08-26-repertoire-knowledge-levels-design.md` (see that file's "Follow-up reversal" amendment at its top, added alongside this document). That design made the Bronze/Silver/Gold/Platinum knowledge-level ladder (`src/lib/mastery/chapterLevels.ts`) a **read-only** classification of already-existing progress. This document adds the ladder's first **write-side consumer**: Learn's own teaching depth.

This design was produced through a full `grilling` session with the user (not a casual request) — the session explicitly surfaced that this repo has built and fully removed three prior sequential-depth-gating systems (`variation_progress.deepest_depth_reached`, the `move_progress`/`level_progress` 3-strikes gauntlet, `chunk_size`/`practice_depth_levels`), and that the immediately-prior design's non-goal on this exact topic was itself per this same user's own earlier clarification. The user weighed that history and confirmed the reversal anyway; every design choice below traces to a specific, explicit answer in that session, not to an assumption made on the user's behalf.

## 1. Executive Summary

### Problem Statement

Learn currently teaches a picked variation end-to-end in one continuous arc, regardless of length — a 6-move trap and a 30-move main line are taught identically fast. The knowledge-level ladder that just shipped classifies a chapter's *already-solved* depth (Bronze ≤9 player moves, Silver ≤18, Gold ≤27, Platinum 28+) but has zero effect on what Learn actually serves. The user wants Learn itself to respect that ladder: don't teach past the current tier's boundary until the tier is actually cleared.

### Proposed Solution

1. Compute one **repertoire-wide teaching ceiling** (a player-move-count, e.g. 9) from the SAME already-existing `deriveChapterLevel` function (`chapterLevels.ts`), applied to the *whole repertoire's variations pooled together* rather than per chapter (see §3, "Why the ceiling is repertoire-wide and pooled, not per-chapter" — this is the one place this design goes beyond what the grilling session's answers alone determine, and the reasoning is spelled out there).
2. A variation's teaching (`variation_teaching_progress.taught_plies`/`mastered_plies`) is never advanced past that ceiling, translated to a ply index within its own path. Once a pass reaches the ceiling without reaching the variation's own true end, that variation is **paused** — not `variation_solved` — and Learn moves on to the next servable variation, which is capped identically.
3. Once every variation at-or-under the current tier is genuinely solved repertoire-wide (recomputed live, not cached — the ceiling can never be "stuck," see §3), the ceiling rises to the next tier, and every paused variation resumes exactly where it left off.
4. The gate applies uniformly to auto-advance and to `VariationPicker`'s manual selection — no exception for a deliberate pick, enforced server-side (not just hidden client-side).
5. A paused variation still appears in the picker, visibly present, disabled, with a short reason — never silently absent.
6. No override/toggle. The gate is unconditional in this first version.

### Success Criteria

- Picking any variation, manually or automatically, teaches it only up to the repertoire's current tier ceiling; a variation whose own length exceeds the ceiling pauses there rather than continuing or being skipped outright.
- A paused variation is never written to `variation_solved`.
- The ceiling only ever reflects live, current progress — there is no cached/stale ceiling value anywhere, and no code path can leave the gate permanently unable to advance.
- `VariationPicker` shows a paused variation as visibly present and locked, not hidden, with a short reason.
- No settings/toggle exists to bypass the gate.
- The existing Levels page, `chapterLevels.ts`'s per-chapter derivations, and Mastered/badge logic are byte-for-byte unaffected — this design adds a new consumer of `deriveChapterLevel`, it does not change that function or any existing caller of it.

---

## 2. User Experience & Functionality

### User Stories

- As a player, I want Learn to teach my repertoire's shallow lines first, everywhere, before it takes me deep into any one line — so I'm not front-loaded with a 20-move main line before the short traps and side branches even exist for me.
- As a player, if I deliberately pick a long line I'm curious about, I understand I'll only be taught as far as my current tier allows, and I'll pick up right where I left off once I've earned the next tier.
- As a player, I don't want to hunt for what's actually available — a line I can't go deeper into yet should still be visible, with a reason, not vanish.

### Acceptance Criteria

- **Ceiling boundaries**: identical to the existing tier boundaries — 9/18/27 player moves. The ceiling in effect at any moment is the max player-move-count of the tier *immediately above* the repertoire's current pooled tier (see §3): 9 when nothing is solved yet, 18 once every ≤9-move variation repertoire-wide is solved, 27 once every ≤18-move variation is, unlimited once every ≤27-move variation is.
- **Pause, not skip, not truncate-forever**: a variation longer than the ceiling is taught up to the ceiling (in the existing 3-move batches, teach-then-blind-retest, completely unchanged in mechanics) and then paused. Pausing writes nothing new to `variation_solved`. The next auto-served variation, or the next manual pick, is unaffected by this variation being paused — Learn simply serves something else.
- **Resume, not restart**: once the ceiling rises, a paused variation resumes from its own persisted `taught_plies`/`mastered_plies` — no re-teaching of what was already mastered under the old ceiling.
- **Applies everywhere, no exceptions**: both the automatic "next variation" advance (`practice_active_variation`'s own advance-on-solve path) and `VariationPicker`'s manual selection are gated identically. Enforcement lives server-side (`/api/practice/select-variation` rejects picking a variation whose own length exceeds the current ceiling, unless it's already solved) — the picker's disabled UI state is a courtesy, not the security boundary.
- **Already-solved variations are exempt**: re-drilling something already learned (via the picker, which is unaffected by this design for solved rows) is never gated — matches the user's own stated reasoning in the grilling session ("it will always be highest level learned if user wants to drill it more").
- **Picker UI**: a paused (locked) variation is shown, not hidden, visibly disabled, with a short reason. A picker bucket/chapter is only shown as itself fully locked when every item inside it is locked; a mixed bucket stays enterable.
- **No override**: no settings, toggle, or "teach it anyway" affordance exists in this version.
- **The ceiling is always live**: recomputed from current `variation_solved` state on every relevant request — never cached, never staleness-tracked, matching `chapterLevels.ts`'s own existing "derived, never stored" convention. This is also what rules out the gate ever getting permanently stuck (see §3).

### Non-Goals

- Any settings/bypass UI (explicitly deferred; the user chose "always on, no override").
- Any change to Practice mode's pool/exclusion logic. A paused variation simply never becomes `solved`, so `splitQueues` (`src/lib/mastery/learning.ts`) — unmodified — already keeps it out of the Practice pool exactly as it would any other unsolved variation. Confirmed by reading `learning.ts`; no code change needed there.
- Any change to `chapterLevels.ts`'s existing exported functions, the Levels page, or Mastered/badge derivation. This design adds one new exported function to `chapterLevels.ts` (see §3) and leaves every existing export's behavior untouched.
- Any change to how a single teaching batch is taught (arrows, blind retest, mistake handling) — `src/lib/mastery/learnDrill.svelte.ts` and the Learn page's UI drive one served path to its own end exactly as today; a ceiling-truncated path is, from the drill's perspective, just a shorter served path. No changes needed there (confirmed by reading the file — it has zero opinion about *why* a served path ends where it does).
- Reordering the automatic sequence by tier within a chapter (`variationSequence.ts`'s existing PGN-order traversal is untouched) — this was already explicitly dropped from the prior design's own proposal, per the same amendment cited above, and nothing in this follow-up reopens it. What changes in `variationSequence.ts` is narrower: skipping a *paused* variation when auto-advancing, not reordering anything.

---

## 3. Technical Specifications

### Architecture Overview

No new tables, no new columns, no new caches. The ceiling is derived, live, from data every relevant request already has or already fetches:

| Concern | Where it lives |
|---|---|
| "What's the repertoire's current teaching ceiling (a player-move-count)?" | New `teachingCeilingMoveCount()` in `chapterLevels.ts` |
| "Is this specific variation currently paused (taught up to the ceiling, not beyond)?" | New `isPausedAtCeiling()` in `teaching.ts` |
| "Given a ceiling, where does this variation's teaching batch/pass actually stop?" | Existing `resolveTeachingStep`/`advanceTeachingProgress` in `teaching.ts`, extended with a `ceilingPly` parameter and a new `pausedAtCeiling` output |
| "Which variation should Learn serve next, skipping paused ones?" | Existing `pickActiveVariation`/`advanceIfSolved` in `variationSequence.ts`, extended with a `blockedKeys` parameter |
| Threading the ceiling through a serve/record round trip | `buildPracticeView` (`practice.ts`), `applyAttemptResult` (`server/practice-progress.ts`), and the three route handlers that call them |
| Manual-pick enforcement | `/api/practice/select-variation` — new rejection when the picked variation is unsolved and longer than the current ceiling |
| Picker UI | `VariationPicker.svelte` + a new `locked`/`playerMoveCount` field the picker's own backing endpoint (`/api/repertoires/[id]/variations`) computes server-side and sends down, so the lock/pause logic exists in exactly one place (the server), not duplicated client-side |

### Why the ceiling is repertoire-wide and pooled, not per-chapter (important — read before implementing)

The grilling session settled a strict, nested rule: a chapter can't advance past a tier until every variation in it is solved at that tier, and *no chapter* can advance past a tier until *every chapter* has cleared it. The naive translation — compute each chapter's own `deriveChapterLevel`, then take `deriveRepertoireLevel` (the existing min-across-chapters function) — has a real bug: `deriveChapterLevel` already treats an *empty* tier bracket within one chapter as vacuously cleared (a chapter with nothing past move 18 can still reach its own ceiling without ever touching Gold). Minning per-chapter LEVELS together re-introduces exactly the problem vacuous-tier handling was built to avoid, one level up: a chapter with *only* long content (say, everything 12+ plies, nothing bronze at all) can never itself "reach bronze" in the traditional sense, and if it's the only slow chapter, per-chapter-then-min would permanently cap the whole repertoire's teaching ceiling at 9 — a genuine deadlock, since there's nothing ≤9 moves anywhere in that chapter to ever solve and lift the cap.

The fix: compute the ceiling from `deriveChapterLevel` applied **once, to every variation in the repertoire pooled together**, ignoring chapter boundaries entirely — treating the whole repertoire as `deriveChapterLevel` already treats one chapter. This is not a new function; it's the *existing*, already-tested `deriveChapterLevel`, called differently. Because the pooled bronze bracket is the union of every chapter's own bronze bracket, "every bronze-bracket variation repertoire-wide is solved" is automatically equivalent to "every individual chapter's own bronze bracket is solved" — the per-chapter half of the grilled rule is a structural consequence of the pooled computation, not something that needs separate code. And because pooling correctly treats a tier with *zero content anywhere in the repertoire* as vacuous (not deadlocked), the deadlock case above resolves itself the same way an individual empty-bracket chapter already does today.

Concretely:

```ts
// chapterLevels.ts — new export, reusing existing internals
export function teachingCeilingMoveCount(
	allVariations: readonly ScopedVariation[], // the WHOLE repertoire, unfiltered — same contract as deriveChapterLevel
	solvedKeys: ReadonlySet<string>
): number {
	const repertoireWideLevel = deriveChapterLevel(allVariations, solvedKeys);
	if (repertoireWideLevel === null) return TIER_MAX_PLAYER_MOVES.bronze;
	const idx = TIER_ORDER.indexOf(repertoireWideLevel);
	const nextTier = TIER_ORDER[idx + 1];
	return nextTier ? TIER_MAX_PLAYER_MOVES[nextTier] : Infinity;
}
```

This is deliberately a **separate call**, not a reuse of the *existing* `deriveRepertoireLevel` (min-across-chapters) — that function keeps its existing meaning and existing single caller (the Levels page's display value, "the repertoire's worst chapter's medal"), which answers a genuinely different question from "how deep can Learn currently teach." The two can legitimately disagree in the pooled-vacuous-chapter case above, and that's correct, not a bug — the display value is unaffected by this whole feature.

### "Paused," precisely, and why it needs a new field rather than reusing `isFinalPass`

`resolveTeachingStep`'s existing `isFinalPass` means "this pass reaches the served path's own end" — today that's *always* the variation's true end, because nothing ever truncates a serve except the existing 3-move batching (which sets `isFinalPass: false` and `arrowPlies` instead). A ceiling introduces a second, structurally different reason a pass can be "the last one served *for now*": it hit the ceiling, not the variation's own leaf. Both `teaching.ts` functions gain a `ceilingPly` parameter (a ply index — units-agnostic w.r.t. tiers; the move-count→ply translation happens once, at the call site, via a new small helper below) and both outputs gain a `pausedAtCeiling: boolean`, computed once and used consistently:

```ts
// teaching.ts

// Existing `plyAfterPlayerMoves` already computes exactly this — "N player
// moves from ply 0" — so this is a one-line, self-documenting wrapper, not new logic.
export function ceilingPlyFor(path: readonly VariationStep[], ceilingMoveCount: number): number {
	return plyAfterPlayerMoves(path as VariationStep[], 0, ceilingMoveCount);
}

export type TeachingStep = {
	path: VariationStep[];
	arrowPlies: { from: number; to: number } | null;
	isFinalPass: boolean;
	/** True only when THIS pass reached path's end because of `ceilingPly`,
	 * not because the variation's own true path ended there. The caller — not
	 * this module — decides what "paused" means downstream (no
	 * variation_solved write, still advance past it when picking what's next). */
	pausedAtCeiling: boolean;
};

export function resolveTeachingStep(
	path: VariationStep[],
	taughtPlies: number,
	masteredPlies: number,
	ceilingPly: number = path.length
): TeachingStep {
	const effectiveLength = Math.min(path.length, ceilingPly);
	if (masteredPlies >= effectiveLength) {
		return {
			path: path.slice(0, effectiveLength),
			arrowPlies: null,
			isFinalPass: true,
			pausedAtCeiling: effectiveLength < path.length
		};
	}
	if (taughtPlies === masteredPlies) {
		const target = Math.min(plyAfterPlayerMoves(path, masteredPlies, TEACHING_BATCH_MOVES), effectiveLength);
		return { path: path.slice(0, target), arrowPlies: { from: masteredPlies, to: target }, isFinalPass: false, pausedAtCeiling: false };
	}
	const target = Math.min(taughtPlies, effectiveLength);
	return {
		path: path.slice(0, target),
		arrowPlies: null,
		isFinalPass: target >= effectiveLength,
		pausedAtCeiling: target >= effectiveLength && effectiveLength < path.length
	};
}

export function advanceTeachingProgress(
	path: VariationStep[],
	taughtPlies: number,
	masteredPlies: number,
	hadMistake: boolean,
	ceilingPly: number = path.length
): { taughtPlies: number; masteredPlies: number; solved: boolean; pausedAtCeiling: boolean } {
	const step = resolveTeachingStep(path, taughtPlies, masteredPlies, ceilingPly);
	if (hadMistake) return { taughtPlies, masteredPlies, solved: false, pausedAtCeiling: false };
	if (step.arrowPlies) return { taughtPlies: step.arrowPlies.to, masteredPlies, solved: false, pausedAtCeiling: false };
	const masteredNow = step.path.length;
	return {
		taughtPlies: Math.max(taughtPlies, masteredNow),
		masteredPlies: masteredNow,
		solved: step.isFinalPass && !step.pausedAtCeiling,
		pausedAtCeiling: step.isFinalPass && step.pausedAtCeiling
	};
}

/** Whether `variation` currently has nothing more to teach under `ceilingMoveCount`
 * — already taught as far as the ceiling allows, but not its own true end.
 * Deliberately NOT true for an untouched (masteredPlies === 0) long variation —
 * that one is still fully servable, up to the ceiling, on its very next pass. */
export function isPausedAtCeiling(
	path: readonly VariationStep[],
	masteredPlies: number,
	ceilingMoveCount: number
): boolean {
	const ceilingPly = ceilingPlyFor(path, ceilingMoveCount);
	return masteredPlies >= ceilingPly && ceilingPly < path.length;
}
```

Note `TEACHING_BATCH_MOVES = 3` divides evenly into every tier boundary (9, 18, 27) — the ceiling always lands exactly on an existing batch boundary, so the `Math.min(..., effectiveLength)` clamps above are a defensive safety net for the reconciliation-regression case below, not something that fires in the ordinary path.

### A ceiling can regress — and that's fine, but must not crash

Reconciliation (a coach re-upload) can demote `variation_solved` rows in one chapter without touching another. Since the ceiling is recomputed live from current `solvedKeys`, a repertoire that had advanced to Silver can, in principle, regress back to a Bronze ceiling if reconciliation demotes enough. A variation already `masteredPlies`-deep past the new, lower ceiling is handled correctly by the `Math.min` clamps above (the served content simply shrinks back to the new ceiling; nothing crashes, and no previously-taught content is deleted — `masteredPlies` itself is untouched, only what's *served* this pass is bounded). This needs an explicit unit test (see §Testing) since it's the one place the ceiling can move in a direction the rest of the design doesn't otherwise exercise.

### Threading the ceiling through `buildPracticeView` and `applyAttemptResult`

Both already receive (or, for `applyAttemptResult`, already fetch) everything needed to compute the ceiling — `variations`/`allVariations` and `solvedKeys` — so neither needs a new query. `/api/practice/attempt` in particular already loads the repertoire's *unfiltered* variation set for an unrelated reason (`cacheCompletedChaptersReached`'s exclusion-blocking requirement) — the ceiling computation piggybacks on that exact same fetch, at zero added query cost.

`buildPracticeView` gains a `ceilingMoveCount: number` parameter (default `Infinity`, so every existing test/call site that doesn't care about tiering keeps behaving exactly as today unless it opts in):

- Computes `blockedKeys` — every unsolved variation currently `isPausedAtCeiling` — and passes it to `pickActiveVariation` so a paused variation is skipped when Learn is choosing what's next, exactly like an already-solved one is today, but WITHOUT writing anything: a `pickActiveVariation`/`advanceIfSolved` caller-supplied stored pointer that happens to point at a now-paused variation must also NOT "win outright" the way a stored pointer to an already-solved one deliberately does today — otherwise a stale pointer would re-serve a frozen board forever instead of advancing. `pickActiveVariation` gains a `blockedKeys` parameter with this precise rule: a stored pointer wins outright only if it's solved OR not blocked; otherwise fall through to the existing "first unsolved" search, itself now also skipping blocked keys.
- When actually serving the picked, not-yet-solved `active` variation's teaching step, computes `ceilingPly = ceilingPlyFor(active.path, ceilingMoveCount)` and passes it into `resolveTeachingStep`.
- The already-solved branch (re-drilling something learned, via the picker) is completely untouched — no ceiling applies there, matching the user's own stated exemption.

`applyAttemptResult` gains the same `ceilingMoveCount` parameter, computed by its one real caller (`/api/practice/attempt`) from the unfiltered fetch it already performs. Its record-time logic gains a third branch alongside "mistake → no-op" and "solved → mark solved, advance, cache completed chapters": **paused → do NOT mark solved, do NOT touch the completed-chapters cache, but DO advance the active pointer** — to the next variation that is neither solved nor blocked, via `advanceIfSolved`'s own new `blockedKeys` parameter (mirroring `pickActiveVariation`'s). Without this third branch, `applyAttemptResult`'s existing early-return-when-`!next.solved` would leave the active pointer stuck re-serving the exact same frozen, paused variation forever — this is the single most important behavioral change in the whole feature, and the one most likely to be gotten subtly wrong (see Testing).

### Manual-pick enforcement (`/api/practice/select-variation`)

This endpoint currently only checks that the requested `variationKey` exists in the player's *filtered* (non-excluded) variation set — nothing stops it from setting a paused-but-unsolved variation active today, in principle (nothing currently distinguishes one), and nothing in the client is a real security boundary. It must:

1. Switch from `loadFilteredRepertoireVariations` to also having the *unfiltered* set available — mirroring `/api/practice/attempt`'s existing pattern — since `teachingCeilingMoveCount`/`deriveChapterLevel` require the unfiltered set per their own documented contract (an excluded, never-solved variation must still block/count).
2. Compute `ceilingMoveCount`, and reject (a clear 4xx, not a 500) a request for a variation that is unsolved AND `playerMoveCount` exceeds the ceiling — i.e. exactly the case `isPausedAtCeiling` would report true for after any prior teaching, but checked directly against `playerMoveCount` here since a *never-attempted* long variation is still fine to select (see Non-Goals — selecting it just teaches up to the ceiling, same as auto-advance would).

Precisely: reject when `!solvedKeys.has(variationKey) && variation.playerMoveCount > ceilingMoveCount && (masteredPlies for it) >= ceilingPlyFor(variation.path, ceilingMoveCount)` — i.e., reject a pick of something *already paused*, not a pick of something merely long-but-untouched. This mirrors `isPausedAtCeiling` exactly; the endpoint should call that function directly rather than re-deriving the same condition.

### Picker UI (`VariationPicker.svelte` + its backing endpoint)

The pause/lock condition is computed **once, server-side**, in `/api/repertoires/[id]/variations` (`src/routes/api/repertoires/[id]/variations/+server.ts`), which already assembles per-row data for this exact picker (and, separately, for the practice-exclusion tree — a shared endpoint, per its own existing doc comment). That handler already has, or can cheaply fetch (`loadTeachingProgress`, already used elsewhere in this codebase for exactly this table), everything `isPausedAtCeiling` needs. Each row gains one new field:

```ts
locked: boolean // true iff this row is unsolved and isPausedAtCeiling(...) is true
```

`VariationPicker.svelte` reads `row.locked` directly — no client-side re-derivation of ceiling/tier logic, no duplicated algorithm. A locked leaf row renders visibly, disabled, with a short reason string (a new message key, see the plan). A move-group bucket or chapter heading is itself shown as locked only when every row inside it is locked; a mixed bucket stays fully enterable, with individual locked rows disabled inside it. The existing "group of one selects directly" shortcut (`soleVariation`) must check `locked` before auto-selecting — a locked bucket-of-one becomes a locked leaf row instead of a folder, matching how an unlocked bucket-of-one already becomes a leaf row today.

### Data Model

No new tables, no new columns, no schema migration. Every new value is derived at read time, exactly like `chapterLevels.ts`'s own existing convention — nothing here needs invalidating, because nothing here is stored.

### Integration Points

- `chapterLevels.ts`: one new exported function (`teachingCeilingMoveCount`). Every existing export, and every existing caller of them (Levels page, badge/status derivation), is untouched.
- `teaching.ts`: `resolveTeachingStep`/`advanceTeachingProgress` gain one new optional parameter each (default preserves today's exact behavior for any caller that doesn't pass it) and one new output field. One new exported function (`ceilingPlyFor`) and one new exported predicate (`isPausedAtCeiling`).
- `variationSequence.ts`: `pickActiveVariation`/`advanceIfSolved` gain one new optional parameter each (default `new Set()`, preserving today's exact behavior).
- `practice.ts` (`buildPracticeView`): one new parameter, threaded through to the two changed modules above.
- `server/practice-progress.ts` (`applyAttemptResult`): one new parameter, one new branch.
- Three call sites updated to compute and pass the ceiling: `/api/practice/attempt`, `/api/practice/select-variation` (also gains the new rejection), `/learn/[repertoire_id]/+page.server.ts`.
- `/api/repertoires/[id]/variations`: two new fields per row (`playerMoveCount`, `locked`).
- `VariationPicker.svelte`: reads the new `locked` field; no algorithmic changes, only rendering.
- Messages (`en.json`/`lt.json`): one new key for the locked-row reason text.

### Security & Privacy

Unchanged in kind from the rest of Learn/Practice — all data is the practicing player's own progress under existing repertoire/practice authorization. The one new consideration is that `/api/practice/select-variation`'s new rejection is a genuine authorization-adjacent check (the gate must hold even against a client that ignores the picker's own disabled state), covered explicitly above and in Testing.

### Testing

- `chapterLevels.test.ts`: `teachingCeilingMoveCount` — boundary values matching the existing tier-boundary tests' style (nothing solved → 9; every ≤9-move variation solved → 18; every ≤18-move solved → 27; every ≤27-move solved → `Infinity`); the pooled-vacuous-chapter case from §3 (a chapter with no bronze content at all must not deadlock the ceiling at 9 forever).
- `teaching.test.ts` (existing file, extend it): `resolveTeachingStep`/`advanceTeachingProgress` with a `ceilingPly` — a variation shorter than the ceiling behaves byte-identical to calling without one; a variation exactly at the ceiling; a variation longer than the ceiling pauses at exactly the right ply, with `pausedAtCeiling: true` and `solved: false`; the ceiling-regression case (masteredPlies already past a newly-lowered ceiling) doesn't crash or produce a negative-length slice.
- `variationSequence.test.ts` (existing file, extend it): `pickActiveVariation`/`advanceIfSolved` with a `blockedKeys` set — a blocked candidate is skipped when searching for the next unsolved one; a stored active pointer that is itself blocked does NOT win outright (falls through), unlike a solved one (which still does, unchanged); walking past every remaining unsolved-and-unblocked variation still terminates (no infinite loop) even when every remaining candidate is blocked.
- `practice.test.ts` (existing file, extend it): `buildPracticeView` with a finite `ceilingMoveCount` — a long variation's served attempt is truncated to the ceiling; the already-solved re-drill branch ignores the ceiling entirely; blocked variations are skipped when auto-picking.
- New coverage in `practice-progress.ts`'s existing test file if one exists, otherwise verified via `npm run check` + the endpoint/manual-verification pass per this repo's `lib/server/` convention: the new paused-branch in `applyAttemptResult` — a clean pass that pauses does NOT call `markVariationSolved`, DOES advance `practice_active_variation` to a different, servable variation.
- `/api/repertoires/[id]/variations`: a new test (or extension of any existing coverage) confirming `locked`/`playerMoveCount` appear correctly per row.
- `VariationPicker.test.ts` (existing file, extend it, matching its existing mock-fetch style): a locked row renders disabled with the reason text and does not call `onselect` when clicked; a mixed bucket (one locked, one not) stays enterable; a locked bucket-of-one renders as a locked leaf row rather than auto-selecting.
- Manual/e2e verification: an actual Learn session on a repertoire with a mix of short and long lines, confirming a long line pauses at move 9, the next auto-served variation is a different (still-servable) one, and the paused line resumes correctly once the rest of Bronze clears.

---

## 4. Risks & Roadmap

### Phased Rollout

- **This design, one pass**: all of the above. No feature flag, no staged rollout — the user's own "always on, no override" decision extends to how it ships, matching this codebase's stated precedent of accepting "no live users yet" as license for a clean cut (see the sibling design's own migration precedent).

### Technical Risks

- **The single biggest risk is the `applyAttemptResult` paused-branch** (§3): getting the "advance the active pointer even though nothing was marked solved" logic wrong silently reproduces the exact failure mode of a stuck gauntlet — a player stuck re-serving a frozen board forever. This is called out explicitly, twice, in this document and must have direct test coverage, not just indirect coverage via the picker or the Levels page.
- **Re-litigating the per-chapter-vs-pooled ceiling question** mid-implementation would be a mistake — §3 documents both the naive approach's real bug and why the fix still honors every grilled decision. An implementer who is tempted to "simplify" back to `deriveRepertoireLevel` (min-across-chapters) should re-read that section first.
- **This reverses a very recently shipped design's explicit non-goal.** The amendment on the sibling design doc, and this document's own opening paragraph, exist so a future reader (including a future AI session) doesn't read the old "teaching is untouched" language as still current without also finding this reversal.
