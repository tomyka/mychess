# Learn / Practice MVP — design

**Epic:** [#95](https://github.com/tomyka/mychess/issues/95) · **Stories:** #104, #96, #97, #98
**Status:** approved for implementation · **Date:** 2026-08-20

Covers the MVP phase only. Status derivation (#99), mastery runs (#100), badges (#101), coach view (#102) and instrumentation (#103) get their own spec when v1.1 starts.

---

## 1. What changes, in one paragraph

A variation stops being "solved after one clean pass" and becomes "learned after two clean passes at least 20 hours apart". Learn serves only un-learned variations; a new Practice surface serves only learned ones, weakest-first, with no arrows; failing a variation in Practice demotes it back to Learn. `variation_solved` keeps its table but changes meaning to *learned*, which is why every existing reader is audited rather than assumed.

## 2. The clean-pass rule (#104)

### Definitions

- **Clean pass** — an attempt covering the variation's final batch, completed with no mistake and no hint. This is exactly what `advanceTeachingProgress(...).solved === true` already signals today; the trust boundary is unchanged (the client reports only `hadMistake`, the server re-derives the served step).
- **Gap** — `LEARN_GAP_MS = 20h`, measured between clean-pass timestamps. Hours, not calendar days, so no player timezone is required.
- **Learned** — a `variation_solved` row exists.

### State machine

New state on `variation_teaching_progress`: `clean_pass_count int not null default 0`, `last_clean_pass_at timestamptz`.

| Current state | Clean pass arrives | Result |
|---|---|---|
| count 0 | — | count 1, `last_clean_pass_at = now`, not learned |
| count 1, gap < 20h | too soon | **count stays 1, timestamp NOT updated**, not learned |
| count 1, gap ≥ 20h | qualifies | count 2, timestamp = now, **learned** → insert `variation_solved` |
| learned | (Practice territory) | no effect here; see #98 |

The "timestamp not updated" row is the load-bearing one: sliding it forward on every early pass would let a player who practises hourly never graduate. Boundary tests at 19h59m and 20h01m are required, driven by an injectable clock — follow `buildPracticeView`'s existing `now: Date = new Date()` parameter precedent rather than reading the clock inside the rule.

A mistaken or hinted pass leaves count and timestamp untouched. It does not reset progress; only #98's demotion does that.

### Serving the pending second pass — the subtle part

After a clean final pass, `masteredPlies` equals the full path length. Left alone, the next attempt would compute `autoPlayThrough = masteredPlies` and auto-play the entire variation, asking the player for nothing — the graduation pass would be un-playable.

Resolution: `buildPracticeView` learns the pending state and serves it explicitly.

- **Pending** = `clean_pass_count ≥ 1` AND not learned.
- A pending variation is served as: **full path, `arrowPlies: null`, `isFinalPass: true`, `autoPlayThrough: 0`** — a cold, blind replay of the whole line, which is precisely the evidence the second pass is meant to provide.
- `masteredPlies` is **not** zeroed. It is true (the player did play it all correctly) and other logic depends on it: `computeMasteredMoveIds` credits sibling variations from mastered prefixes, and zeroing would silently withdraw that credit from unrelated lines.

Before the 20h gap elapses, a pending variation is **not served by Learn at all** — it is neither learnable (nothing left to teach) nor learned (can't go to Practice). Learn moves to the next un-learned variation and shows the pending one as waiting, with a "come back tomorrow" cue. If every remaining variation is pending, Learn says so rather than looking empty or finished.

### Data flow

```
handleMove (client)          → POST /api/practice/attempt { hadMistake }
applyAttemptResult (server)  → advanceTeachingProgress()        // unchanged
                             → if solved: applyCleanPass(state, now)   // NEW, pure
                             → saveTeachingProgress(+ count, timestamp)
                             → if learned: markVariationSolved() + advance active variation
```

`applyCleanPass` is pure, lives in `src/lib/mastery/learning.ts`, and is the only place the 20h rule exists.

## 3. Learn serves only un-learned variations (#96)

- `pickActiveVariation` / `buildPracticeView` filter out learned and excluded variations, and skip pending-but-not-yet-eligible ones as described above.
- Route becomes `/learn/[repertoire_id]`. **No redirect from the old path** — corrected during implementation: #97 claims `/practice/[repertoire_id]` for the Practice pool, so a permanent redirect there would have to be torn straight back out. An old bookmark therefore lands on the pool, which for an un-learned repertoire shows its own locked state pointing at Learn. That is self-explanatory, and honest about what now lives at that URL. The rename and the pool must ship together so no interim 404 is ever user-visible.
- Graduation mid-session advances to the next un-learned variation without a reload — the existing `nextAttempt()` merge path already does this; it just needs the filter applied.
- The "Repertoire Solved!" trophy is replaced by a Learned state pointing at Practice. Its meaning (one clean pass each) ceases to exist.

## 4. Practice pool (#97)

- New `/practice/[repertoire_id]`: learned, non-excluded variations only. **No arrows in any state** — `arrowPlies` is always null, `autoPlayThrough` always 0.
- **Ordering:** error rate descending, then staleness. Pure function over rows already in `move_attempts` (`player_id`, `move_id`, `is_correct`, timestamp), aggregated per variation via the variation's own `moveId`s.
- **Cold start:** no attempt rows → least-recently-practised first, then repertoire order. Ships with the feature; without it the first Practice session serves an arbitrary-looking line.
- Zero learned variations → locked state pointing at Learn.
- **Invariant (epic success criterion 1):** the Learn queue and the Practice queue are disjoint for a given player+repertoire. Asserted directly in a unit test over the two selection functions, not inferred from UI behaviour.

## 5. Demotion (#98)

- A mistake **or** a hint on a Practice attempt demotes: delete the `variation_solved` row, set `clean_pass_count = 0`, clear `last_clean_pass_at`.
- Consistency with #92: a hint already marks a pass dirty; needing a piece revealed on supposedly-learned material means it isn't learned.
- Each demotion writes one `variation_demotions(player_id, repertoire_id, variation_key, demoted_at, cause)` row, `cause ∈ {mistake, hint}` — the data behind epic success criterion 3.
- The player is told, in the moment, that the line went back to Learn and why.
- `taughtPlies`/`masteredPlies` are left as they are: the line gets re-taught by the existing batch machinery, and zeroing them would restart a long variation from its first batch, which is harsher than intended.

## 6. Schema

```sql
alter table public.variation_teaching_progress
  add column if not exists clean_pass_count int not null default 0,
  add column if not exists last_clean_pass_at timestamptz;

create table if not exists public.variation_demotions (
  id           bigserial primary key,
  player_id    uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  variation_key text not null,
  demoted_at   timestamptz not null default now(),
  cause        text not null check (cause in ('mistake','hint'))
);
```

- RLS in the established pattern: **single-operation policies** (a broad `for all` ORs together with narrower ones and defeats them), plus `revoke all on public.variation_demotions from anon, public`.
- No local Postgres and no linked CLI in this environment: migration files are written here and pasted into the Supabase dashboard by the user. **Nothing may assume a migration has run** — code that reads the new columns ships only after confirmation.
- Existing `variation_solved` rows (32 in prod across 2 players) are grandfathered as learned; the new columns are simply absent/zero for them, which reads correctly since the row itself is the learned marker.

## 7. Testing strategy

- **Pure logic, unit-tested, no DB:** `applyCleanPass` (including both gap boundaries and the no-slide rule), pending-state serving in `buildPracticeView`, Practice ordering incl. cold start, the disjointness invariant, demotion state transitions.
- **Existing suites updated, not deleted:** `practice.test.ts` for the route rename and the new pending state; `teaching.test.ts` / `practice.test.ts` in `src/lib/mastery/` for the changed meaning of solved.
- Server IO modules follow repo precedent and stay unit-test-free, exercised through the pure logic plus manual verification.
- Gate before every push: `npm test`, `npm run lint`, `npm run check` — all zero errors (lint is CI-gated as of #91).

## 8. Sequencing and risk

Build order is #104 → #96 → #97 → #98. Each lands behind the migration it needs.

| Risk | Handling |
|---|---|
| Code reading new columns before the migration runs → PostgREST 400s in prod | Work on a branch; merge only after the user confirms the migration is applied |
| Repointing `variation_solved`'s meaning breaks a reader | #104 audits every reader explicitly and lists them in its PR |
| 20h gap makes a 3-variation test repertoire feel broken | Pending state must be visible in the UI, with an explicit "come back tomorrow" cue |
| Cold-start ordering absent | Shipped in #97 itself, with its own test |
| Sibling mastery credit silently withdrawn | `masteredPlies` deliberately not zeroed on a pending pass (§2) |
