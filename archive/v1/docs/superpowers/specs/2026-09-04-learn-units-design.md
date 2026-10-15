# Learn units: replacing the locked/paused ceiling model

GitHub issue #182. Supersedes `2026-08-26-tier-gated-learn-design.md`,
`2026-09-01-shared-prefix-ceiling-deferral-design.md` and
`2026-09-02-ceiling-reached-progress-design.md`.

## Problem

The Learn picker exposes three overlapping states — `locked` 🔒,
`pausedAtCeiling` ⏳, `solved` ✓ — plus a legend, ceiling-prefix grouping
folders, and disabled rows. They come from the tier-ceiling design: a long
variation is truncated at the current tier's move cap, "pauses" there, and
siblings sharing that credited prefix are "deferred". The result is a list
where most rows are unclickable and the player cannot tell what to do next.

Three predicates (`isLockedForTier`, `isPausedAtCeiling`,
`isCeilingReachedAnywhere`) each independently answer a slightly different
version of "can this be taught", have been rewired four times across issues
#163/#165/#168/#172/#181, and still disagree at the edges.

## The redefinition

Truncation stays. Every status goes away.

The insight: once a variation is clipped at a band cap, **the thing being
learned is not a variation — it is a distinct clipped prefix.** Many
variations collapse onto the same prefix. Deduplicate them and the list
becomes short, flat and entirely actionable, so there is nothing left to
lock, pause, defer or tick.

### Bands

By the player's own move count, inclusive upper bounds:

| Band | Cap |
|---|---|
| bronze | 9 |
| silver | 18 |
| gold | 27 |
| platinum | ∞ |

### Learn unit

A **learn unit** is one chapter's variations clipped to that chapter's
current band cap, deduplicated by the clipped move-id chain.

- Its key is that move-id chain — the same `>`-joined format as
  `variationKey`, so a unit reaching a variation's real end *is* that
  variationKey. No new key format, no schema change.
- **The clip extends to the path's own end whenever nothing past the cap is
  the player's own move.** `enumerateVariations` emits lines that end on the
  *opponent's* reply (a PGN chapter stopping there), and the cap lands just
  after the Nth **player** move. Clipping such a line at the cap would leave a
  strict prefix with no player move withheld, so a clean pass could only ever
  report `unitComplete`, never `solved` — `variation_solved` would never be
  written and the line could never enter the Practice pool at *any* band,
  since the band it sits in is already its chapter's deepest. One function,
  `bandCapPly`, owns this and is used by both unit construction and the
  serving cap; those two disagreeing is the bug class this module exists to
  remove.
- Its **representative** is the member variation with the *shortest* path.
  This matters: when a 9-move variation and a 20-move variation share the
  same first 9 moves, they are one bronze unit, and serving the 9-move one
  finishes a real variation (writing `variation_solved`, so it enters the
  Practice pool) instead of only banking progress.
- A unit is **learned** when every move-id in its clipped path is in
  `masteredMoveIds` — i.e. it has had one clean, mistake-free, hint-free
  blind replay, possibly earned via a sibling sharing those moves.

### Bands are gated per chapter

Each chapter has its own current band: **the lowest band holding an unlearned
unit.** Bands are nested prefixes, so if a band is fully learned every band
below it is too — the lowest unlearned band is always well defined, and a
band that adds no new content is skipped for free. When no band has an
unlearned unit the chapter is **complete**.

- Chapter medal = the highest fully-learned band, clamped to the band of the
  chapter's own deepest variation. A chapter topping out at 9 moves shows
  Bronze/complete rather than a fabricated Platinum.
- Repertoire level = the minimum across chapters (`deriveRepertoireLevel`,
  unchanged in meaning).

### Nothing is blocked

The Learn list for a chapter is exactly its current-band units minus the
learned ones. Every row in it is learnable right now. There is no locked
state, no paused state, no deferred sibling, no disabled row, and no tick —
a learned unit is simply absent.

## Serving and recording

Unchanged mechanics, re-pointed at units:

- To serve a unit, serve its representative variation with `ceilingPly` set
  to the unit's clipped length. `resolveTeachingStep` already does this.
- Recording stays `advanceTeachingProgress`, with one rename:
  `pausedAtCeiling` → `unitComplete`. It stops meaning "stuck" and starts
  meaning "this unit is done, move on".
- `solved` keeps its narrower meaning — the variation's *real* end — and
  remains the only thing that writes `variation_solved`.
- The Practice pool is therefore untouched: it reads `solvedKeys`. A 9-move
  prefix of a 20-move line leaves Learn without entering Practice; that line
  enters Practice once its chapter reaches the band covering its full length.
- Excluded variations produce no unit and block nothing. This inverts the
  prior deliberate behaviour (exclusions used to block the ladder) and is the
  reading that matches "I do not want to learn this line".

### Per-variation cap

A variation can belong to several chapters sitting at different bands. Its
serving cap is the **maximum** clipped length across the chapters it belongs
to, so no chapter's own progress can hold back another's. An already-solved
variation is never capped — a re-drill is served in full, as today.

## Architecture

One new pure module replaces two:

`src/lib/mastery/learnUnits.ts` owns bands, clipping, dedupe, band advance,
chapter completeness and medal derivation. `chapterLevels.ts` is deleted.
The `Tier` type is renamed `Band`, which also removes a standing collision
with `chapterTiers`/`rowsInChapterTier` (a *navigation* concept, unrelated to
medals).

Its single entry point for the Learn flow:

```ts
deriveLearnPlan(variations, masteredMoveIds): LearnPlan
```

returning, per chapter, its band/medal/completeness/unlearned units, plus a
`ceilingPlyByVariationKey` map and an ordered `servableVariationKeys` list.
Every consumer reads that one value instead of deriving anything of its own:
the Learn page, the picker endpoint, `buildPracticeView`,
`applyAttemptResult`, `select-variation`, **the Levels page, the coach
student-progress view and the Mastered badge count**. This is the property the
old design lacked — eight call sites each deriving their own answer from the
same inputs, which is what made issue #181 take five commits to land.

Three helpers read off a derived plan rather than re-deriving:

- `completedChapterNames(plan)` — the set `deriveRepertoireStatus` and the
  `chapter_completed` cache both want, naming a chapterless repertoire's flat
  pool `UNTAGGED_CHAPTER` to match `masterableChapters`.
- `activeChapterState(plan, variations, activeKey)` — the chapter being worked
  in, for the Learn page's band bar. `null` once nothing is unfinished, so the
  bar hides rather than sitting permanently full.
- `nextServableVariationKey(plan, variations, finishedKey)` — what to serve
  next, preferring a unit in a chapter the finished line also belongs to.
  Without that preference, per-chapter gating would bounce the player back to
  the first chapter after every single line. Replaces `advanceIfSolved`'s walk
  (and `nextVariation` with it), which had to skip solved and blocked entries
  as it went and could revisit a duplicate key forever.

`servableRepresentativeFor(plan, key)` resolves *any* member of an unlearned
unit to that unit's representative. `select-variation` uses it rather than
testing membership of `servableVariationKeys`, which holds only
representatives: a longer member of a perfectly teachable unit would
otherwise be rejected as "already learned", and `pickActiveVariation` would
treat it as a stale pointer and silently serve something else.

### Deletions

| File | Removed |
|---|---|
| `teaching.ts` | `isPausedAtCeiling`, `isLockedForTier`, `isCeilingReachedAnywhere`, `computeBlockedKeys`, `wouldMerelyPauseAt`, `computeMasteredPliesMap` |
| `chapterLevels.ts` | whole file (`teachingCeilingMoveCount`, `currentLevelProgress`, `hasReachedCeiling`, `chapterCeiling`, `tierForMoveCount`) |
| `variations.ts` | `groupByCeilingPrefix` |
| `variationSequence.ts` | every `blockedKeys` parameter, plus `advanceIfSolved` and `nextVariation` — both left with no callers once the plan owns "what's next" |
| `VariationPicker.svelte` | legend, 🔒 ⏳ ✓, `statusTitle`, `ceilingGroupDone`, `ceilingGroupPaused`, `isFrontier`, the `PickerEntry` union, every `disabled` |
| messages | `variation_picker_legend`, `_locked_reason`, `_paused_reason`, `_learned_reason` (all locales) |

### Endpoint split

`/api/repertoires/[id]/variations` is consumed by two callers with different
questions — the picker, and the exclusion checkbox tree on `/repertoires` —
which is why it accumulated `locked`/`pausedAtCeiling`/`ceilingMoveCount`
next to `includedByChapter`. Split it:

- `/api/repertoires/[id]/variations` keeps serving the exclusion tree, minus
  the three ceiling fields.
- `/api/repertoires/[id]/learn-units` is new and serves the picker: per
  chapter, its band, its band progress, and its unlearned units. A finished
  chapter arrives with an empty `units` — that *is* the signal, so there is no
  separate `complete` flag to keep in step with it. The wire types
  (`LearnUnitView`, `LearnChapterView`, `LearnUnitsResponse`) live in
  `learnUnits.ts` and are shared by the route and the picker, so a field
  rename can't drift between them.

`select-variation` rejects a pick with no unlearned unit (409, "already
learned") rather than 403-ing a "locked" one.

## UI

The picker keeps chapter tier → move-group folders → rows, with folders now
built over clipped unit paths via the existing `groupByFirstMoves`. Every row
is clickable and none is decorated. A chapter with nothing left to learn is
**omitted from the chapter list** rather than shown as an empty dead end —
the same rule as within a chapter, where learned content is absent rather
than disabled. When every chapter is finished the picker says so in one line.
The Learn progress bar shows the active chapter's band and `learned/total`
within that band.

## Testing

- `learnUnits.test.ts`: dedupe, shortest-representative choice, band advance,
  skipped no-new-content band, per-chapter independence, medal clamping,
  exclusions producing no unit, multi-chapter cap maximisation, the
  opponent's-reply clip extension (and that it does *not* swallow a real
  player move past the cap), plus `activeChapterState`,
  `nextServableVariationKey`, `servableRepresentativeFor` and
  `completedChapterNames`.
- Updated: `teaching.test.ts`, `practice.test.ts`, `variations.test.ts`,
  `VariationPicker.test.ts`, `learn.test.ts`, `practice-progress.test.ts`.
- `npm test`, `npm run check`, `npm run lint` all clean.
- End-to-end via `npm run qa:verify-learn` on a real multi-chapter PGN.
