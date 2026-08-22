# Lithuanian Content Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sweep every hardcoded user-facing string in the app's routes and shared components, the magic-link email, and per-page SEO tags into Paraglide message keys with real English and Lithuanian text, so the language switcher built in Epic 1 actually changes what the user sees.

**Architecture:** For each file: read it, find every hardcoded user-facing string (button text, headings, labels, placeholders, error/empty-state messages, `aria-label`s, `<svelte:head>` title/description), add a key + English value (verbatim, matching the current text) to `messages/en.json` and a real Lithuanian translation to `messages/lt.json`, then swap the call site from the literal to `m.<key>()`. Count+noun strings use Paraglide's CLDR plural-match syntax so Lithuanian gets its correct `one`/`few`/`other` (and `many`, for the rare fractional case) noun forms, not a single generic form.

**Tech Stack:** SvelteKit 2 / Svelte 5, `@inlang/paraglide-js` (already set up in Epic 1), Vitest + `@testing-library/svelte`.

Spec: `docs/superpowers/specs/2026-08-21-lithuanian-content-translation-design.md`

All commands below run from `mychess/` (the SvelteKit app directory). If any `npm`/`npx` command fails with `EBADENGINE`, prepend `PATH="/c/Users/tomyk/.config/herd/bin/nvm/v22.22.3:$PATH"`.

---

## Methodology (read this before Task 1 — every task below applies it)

### Message keys

`snake_case`, prefixed by area: `nav_*`, `login_*`, `welcome_*`, `join_*`, `dashboard_*`, `learn_*`, `practice_*`, `repertoires_*`, `drill_*`, `time_trial_*`, `coaches_*` (player-side coaches page), `settings_*`, `cosmetics_*`, `badges_*`, `tournaments_*`, `games_*`, `coach_*` (coach-side pages), `support_*`, plus a per-component prefix for shared components used across areas (`chessboard_*`, `move_nav_*`, `pgn_import_*`, etc.). SEO tags: `seo_<page>_title` / `seo_<page>_description`.

**Never translate "MyChess"** — it's the product name, a proper noun, identical in every locale.

### The procedure, per file

1. Read the file. List every hardcoded user-facing string (skip class names, variable names, comments, and anything that's already dynamic data like a player's name or a tournament title pulled from the DB).
2. For each string: pick a key, add it to `messages/en.json` with the **current exact text as the value** (no wording changes — this keeps existing test assertions passing, per the verified behavior below), and add the Lithuanian translation to `messages/lt.json` under the same key.
3. Swap the call site: `<h1>Tournaments</h1>` → `<h1>{m.tournaments_heading()}</h1>`; `aria-label="Previous"` → `aria-label={m.tournaments_prev_page()}`.
4. For a count+noun string, use the plural-match form (Worked Example 2 below) instead of a plain key.
5. Run `npm run check`, `npm run lint`, and the file's own test (if it has one) after each file or small group of files — don't batch 10 files' worth of changes before checking any of them.
6. Self-review the file once more for anything missed (a second read, specifically hunting for stray literal text) before moving to the next file.

### Verified: this doesn't break existing tests

Confirmed empirically during brainstorming: calling a generated `m.xxx()` function outside a real HTTP request — exactly what happens in this repo's Vitest component tests — resolves to the `en` base locale with no error, no mocking required. So `getByText('Upload a game')` / `getByLabelText('Paste PGN text')`-style assertions keep passing unmodified once the literal is replaced by `m.xxx()`, **as long as `en.json`'s value matches the replaced string exactly**. The one exception is when a string genuinely needs to change to be correctly pluralized (Worked Example 2) — in that case, update the specific test assertion to match, and say so explicitly in that task.

### Rule for pre-existing always-plural English (added after Task 5's review)

Several count+noun strings in this app were already grammatically wrong before this migration — always plural regardless of count (e.g. Worked Example 2's "1 blunders, 1 mistakes"; also `learn_progress_count`'s "1 / 1 variations learned", left as-is in Task 5 as a one-off exception before this rule was written down). **From Task 6 onward, the rule is: fix it.** When you find a pre-existing always-plural English string, give it a correct `one` variant in the plural-match key and update whichever test asserted the old always-plural wording (same pattern as Worked Example 2) — don't preserve the grammatically-wrong wording just to avoid touching a test. Say explicitly in your report which test assertion(s) you updated and why. (`learn_progress_count` itself is not being retroactively fixed — it's a known, deliberately-accepted inconsistency from before this rule existed, not worth a dedicated follow-up task on its own.)

### Pattern for Lithuanian grammatical case (added after Task 5's review)

Lithuanian nouns decline by case depending on their grammatical role in a sentence — the same English word (e.g. "Practice") can need two different Lithuanian forms depending on whether it's a direct object ("moves to Practice" → accusative "Praktiką") or a locative ("stays sharp in Practice" → locative "Praktikoje"). When you hit this, split into role-specific keys (e.g. `learn_practice_to_link` / `learn_practice_in_link`) rather than trying to force one key to cover both — English can share one word across roles, Lithuanian can't. This already came up in Task 5 and is likely to recur in Tasks 6, 8, 9, and 12 wherever a noun like "chapter," "student," or "repertoire" appears in more than one grammatical role. If you reuse a message key across areas (e.g. a `practice_status_*` key from Task 4 reused in a Learn-flow file), leave a one-line comment at the reusing call site noting it's intentional shared copy — don't let the cross-area coupling go undocumented.

### Worked Example 1 — plain string swap

`src/routes/tournaments/+page.svelte:56, 61, 66, 70, 100-101`, before:

```svelte
<svelte:head>
  <title>OTB Tournaments — MyChess</title>
</svelte:head>
...
<h1 class="text-2xl font-bold text-(--color-text)">Tournaments</h1>
...
>List</button>
...
>Calendar</button>
...
<p class="font-medium">No tournaments found</p>
<p class="text-sm mt-1">Try adjusting your filters</p>
```

`messages/en.json` additions:

```json
"seo_tournaments_title": "OTB Tournaments — MyChess",
"tournaments_heading": "Tournaments",
"tournaments_view_list": "List",
"tournaments_view_calendar": "Calendar",
"tournaments_empty_heading": "No tournaments found",
"tournaments_empty_hint": "Try adjusting your filters"
```

`messages/lt.json` additions:

```json
"seo_tournaments_title": "Gyvi turnyrai — MyChess",
"tournaments_heading": "Turnyrai",
"tournaments_view_list": "Sąrašas",
"tournaments_view_calendar": "Kalendorius",
"tournaments_empty_heading": "Turnyrų nerasta",
"tournaments_empty_hint": "Pabandykite pakeisti filtrus"
```

After:

```svelte
<svelte:head>
  <title>{m.seo_tournaments_title()}</title>
</svelte:head>
...
<h1 class="text-2xl font-bold text-(--color-text)">{m.tournaments_heading()}</h1>
...
>{m.tournaments_view_list()}</button>
...
>{m.tournaments_view_calendar()}</button>
...
<p class="font-medium">{m.tournaments_empty_heading()}</p>
<p class="text-sm mt-1">{m.tournaments_empty_hint()}</p>
```

Plus the script-block import: `import { m } from '$lib/paraglide/messages';`

### Worked Example 2 — pluralization (with a required test fix)

`src/routes/(player)/games/+page.svelte:52`, before (note: this is **already grammatically wrong English** — always plural regardless of count):

```svelte
· {summary.blunders} blunders, {summary.mistakes} mistakes, {summary.inaccuracies} inaccuracies
```

`src/routes/(player)/games/games.test.ts:46`, existing assertion (will need updating — see below):

```ts
expect(screen.getByText(/1 blunders, 1 mistakes, 0 inaccuracies/)).toBeTruthy();
```

`messages/en.json` addition (English only needs `one`/`other`):

```json
"games_blunder_count": [
	{
		"declarations": ["input count", "local countPlural = count: plural"],
		"selectors": ["countPlural"],
		"match": {
			"countPlural=one": "{count} blunder",
			"countPlural=other": "{count} blunders"
		}
	}
],
"games_mistake_count": [
	{
		"declarations": ["input count", "local countPlural = count: plural"],
		"selectors": ["countPlural"],
		"match": {
			"countPlural=one": "{count} mistake",
			"countPlural=other": "{count} mistakes"
		}
	}
],
"games_inaccuracy_count": [
	{
		"declarations": ["input count", "local countPlural = count: plural"],
		"selectors": ["countPlural"],
		"match": {
			"countPlural=one": "{count} inaccuracy",
			"countPlural=other": "{count} inaccuracies"
		}
	}
]
```

`messages/lt.json` addition (Lithuanian needs `one`/`few`/`other`, plus `many` for the fractional edge case — these counts are always whole numbers in this app, but including it avoids relying on undocumented fallback behavior for a selector value with no matching variant):

```json
"games_blunder_count": [
	{
		"declarations": ["input count", "local countPlural = count: plural"],
		"selectors": ["countPlural"],
		"match": {
			"countPlural=one": "{count} žiopla klaida",
			"countPlural=few": "{count} žioplos klaidos",
			"countPlural=many": "{count} žioplos klaidos",
			"countPlural=other": "{count} žioplų klaidų"
		}
	}
],
"games_mistake_count": [
	{
		"declarations": ["input count", "local countPlural = count: plural"],
		"selectors": ["countPlural"],
		"match": {
			"countPlural=one": "{count} klaida",
			"countPlural=few": "{count} klaidos",
			"countPlural=many": "{count} klaidos",
			"countPlural=other": "{count} klaidų"
		}
	}
],
"games_inaccuracy_count": [
	{
		"declarations": ["input count", "local countPlural = count: plural"],
		"selectors": ["countPlural"],
		"match": {
			"countPlural=one": "{count} netikslumas",
			"countPlural=few": "{count} netikslumai",
			"countPlural=many": "{count} netikslumo",
			"countPlural=other": "{count} netikslumų"
		}
	}
]
```

After, in `games/+page.svelte`:

```svelte
· {m.games_blunder_count({ count: summary.blunders })}, {m.games_mistake_count({ count: summary.mistakes })}, {m.games_inaccuracy_count({ count: summary.inaccuracies })}
```

**Required test fix** in `games.test.ts:46` — the English text for `count: 1` is now correctly singular ("1 blunder", "1 mistake"), so the assertion must change to match:

```ts
expect(screen.getByText(/1 blunder, 1 mistake, 0 inaccuracies/)).toBeTruthy();
```

(This is the one place in this whole plan where a test assertion changes rather than continuing to pass unmodified — because the pre-existing English was grammatically wrong and fixing it to be pluralization-correct necessarily changes the `count: 1` output. Every other file's tests should need no changes.)

### Shared components: check for cross-page test coupling first

Before translating a shared component (`src/lib/components/*.svelte`, not a route file), grep for every place it's imported and every test file that renders it, and read `MoveNavRow.svelte`'s own header comment as the reference example of why this matters — its `aria-label`s are asserted by multiple pages' tests (Learn, Practice, and now the Games page), so a key's English value must stay exactly what all of those tests expect, or all of them need updating together, not just the one you're currently working on.

### Known dead files — skip, no content to translate

- `src/routes/tournaments/[id]/+page.svelte` — 0 bytes, currently unreachable content-wise (filed as issue #134, unrelated to this epic).
- `src/routes/join/[token]/+page.svelte` — 0 bytes, same situation (also issue #134).

Don't build the missing UI for these as part of this plan — that's out of scope here.

---

### Task 1: Global shell — NavBar, root layout

**Files:**
- Modify: `mychess/src/lib/components/NavBar.svelte`
- Modify: `mychess/src/routes/+layout.svelte` (only if it has user-facing text beyond the `<title>MyChess</title>` brand name, which is not translated)
- Modify: `mychess/messages/en.json`, `mychess/messages/lt.json`

- [ ] **Step 1:** Read `NavBar.svelte` in full. Translate every nav link label ("Players", "Repertoires", "Dashboard", "Tournaments", "Learn", "Practice", "Coaches", "Sign in", "Settings", "Customise", "Badges", "Sign out") and any `aria-label`s (e.g. "Close menu", "Toggle mobile menu") — do **not** touch the `LanguageSwitcher` import/usage or its own `language_switcher_label` key, both already exist from Epic 1.
- [ ] **Step 2:** Check `+layout.svelte` for any visible text beyond the brand name — likely none, but confirm.
- [ ] **Step 3:** Run `npm run check && npm run lint`. `NavBar.svelte` has no dedicated test file today (confirmed in Epic 1) — no test to update, but check whether any *other* file's test renders `NavBar` and asserts on its text (grep for `NavBar` in `*.test.ts` files) before assuming there's nothing to verify.
- [ ] **Step 4:** Commit: `git add src/lib/components/NavBar.svelte src/routes/+layout.svelte messages/en.json messages/lt.json` (drop any file that didn't actually change), message `"feat(i18n): translate navbar and layout"`.

---

### Task 2: Auth & onboarding — login, welcome, magic-link email

**Files:**
- Modify: `mychess/src/routes/login/+page.svelte`
- Modify: `mychess/src/routes/welcome/+page.svelte`
- Modify: `mychess/supabase/templates/magic_link.html`
- Modify: `mychess/messages/en.json`, `mychess/messages/lt.json`

- [ ] **Step 1:** Translate every string in `login/+page.svelte` (already read during planning — includes "Sign in to save your progress", "Check your email", "We sent a sign-in link to {email}. Open it on this device to continue.", "Use a different email", "Continue with Google", "or", "Email", the `you@example.com` placeholder, "Keep me signed in", "Please wait…"/"Email me a magic link", "Continue without account →", and the inline `error = 'Enter your email address'` / `'Could not send the link'` strings in the `<script>` block — these need `m.xxx()` calls too, imported the same way).
- [ ] **Step 2:** Translate every string in `welcome/+page.svelte` (already read during planning — "Welcome! What's your name?", "So we can set up your dashboard", "First Name"/"Last Name" labels, "e.g. Magnus"/"e.g. Carlsen" placeholders, "Get started →"). Any `form?.error` message strings live in `welcome/+page.server.ts` — check that file too and translate any `fail(...)` message text there (server-side code can call `m.xxx()` the same way).
- [ ] **Step 3:** Rewrite `supabase/templates/magic_link.html` as a single bilingual template per the spec's decision (§ Magic-link email) — keep the existing English content exactly as-is, add the same content in Lithuanian directly below it (e.g. a `<hr>` divider, then a repeat of the greeting/button/code-box/footer in Lithuanian). This file is **not** Paraglide-driven — it's Go template syntax rendered by Supabase directly, so hand-write both languages' HTML inline rather than using `m.xxx()`.
- [ ] **Step 4:** Run `npm run check && npm run lint && npm test` (check whether `login`/`welcome` have colocated tests first — grep for `login.test.ts`/`welcome.test.ts` — and if so, verify their assertions still pass or need updating for any string you deliberately changed for grammatical correctness).
- [ ] **Step 5:** Commit: `git add src/routes/login src/routes/welcome supabase/templates/magic_link.html messages/en.json messages/lt.json`, message `"feat(i18n): translate login, welcome, and the magic-link email"`.

---

### Task 3: Dashboard & shared dashboard components

**Files:**
- Modify: `mychess/src/routes/(player)/+page.svelte`
- Modify: `mychess/src/lib/components/QuickActions.svelte`, `PlayerHeader.svelte`, `StatsRow.svelte`, `PracticeStatusStrip.svelte`, `CoachNoteBanner.svelte`, `RepertoireUpdatedBanner.svelte` (confirm each is actually rendered by the dashboard page before translating it — grep its imports; if a component turns out to be used elsewhere too, note that in your report rather than silently skipping it)
- Modify: `mychess/messages/en.json`, `mychess/messages/lt.json`

- [ ] **Step 1:** Read `(player)/+page.svelte` and every component it imports. Apply the methodology to every hardcoded string, including the `<svelte:head>` SEO tag.
- [ ] **Step 2:** Watch for streak/count strings (e.g. a "days" streak counter, if the dashboard renders one) — use the plural-match pattern from Worked Example 2.
- [ ] **Step 3:** Run `npm run check && npm run lint`, plus any existing tests for these files (grep for `*.test.ts` colocated with each).
- [ ] **Step 4:** Commit: `git add src/routes/\(player\)/+page.svelte src/lib/components/QuickActions.svelte src/lib/components/PlayerHeader.svelte src/lib/components/StatsRow.svelte src/lib/components/PracticeStatusStrip.svelte src/lib/components/CoachNoteBanner.svelte src/lib/components/RepertoireUpdatedBanner.svelte messages/en.json messages/lt.json` (only the files that actually changed), message `"feat(i18n): translate the player dashboard"`.

---

### Task 4: Shared move/board components (translate before Tasks 5, 6, 7, and 11 — Learn, Practice, Drill/Time-trial, and Games all consume these)

**Files:**
- Modify: `mychess/src/lib/components/ChessBoard.svelte`, `MoveNavRow.svelte`, `EvalBar.svelte`, `PracticeStatusStrip.svelte`

**Plan correction (found during Task 3's code-quality review):** `PracticeStatusStrip.svelte` was never assigned to any task — it's rendered by both `learn/[repertoire_id]/+page.svelte` and `practice/[repertoire_id]/+page.svelte`, so it belongs here alongside the other components shared by both flows, rather than being duplicated into (or missed by) Task 5 and Task 6 separately.

- [ ] **Step 1:** Read all four. `MoveNavRow.svelte`'s `aria-label`s ("Jump to start", "Move back", "Move forward", "Jump to current position") are asserted by Learn's, Practice's, **and now Games'** tests (confirmed during planning — `analysis.test.ts` doesn't currently assert them, but Learn/Practice tests do per `MoveNavRow.svelte`'s own header comment) — translate them to `m.move_nav_*()` keys with the English value matching exactly what those tests expect today, so no other task needs to touch this file again. `PracticeStatusStrip.svelte`'s `COPY` record (blind/wrong/correct/autoplay/retest-cue/demoted/exploring statuses) plus its "Need a hint?" button all need translating — `PracticeStatusStrip.test.ts` asserts several of these exact strings, so English values must match verbatim.
- [ ] **Step 2:** `ChessBoard.svelte`/`EvalBar.svelte` — translate anything user-facing (likely minimal; `chessground`'s own board rendering has no text, but check for any label/tooltip this app added on top; `EvalBar.svelte`'s `aria-label`s are asserted by its own test).
- [ ] **Step 3:** Run `npm run check && npm run lint`, then specifically run any Learn/Practice/Games test files that render `MoveNavRow` to confirm nothing broke: grep for `MoveNavRow` across `*.test.ts` and run each one found, plus `PracticeStatusStrip.test.ts` and `EvalBar.test.ts`.
- [ ] **Step 4:** Commit: `git add src/lib/components/ChessBoard.svelte src/lib/components/MoveNavRow.svelte src/lib/components/EvalBar.svelte src/lib/components/PracticeStatusStrip.svelte messages/en.json messages/lt.json`, message `"feat(i18n): translate shared board/move-nav components"`.

---

### Task 5: Learn

**Precondition:** Task 4 (shared move/board components) is done.

**Files:**
- Modify: `mychess/src/routes/(player)/learn/+page.svelte`, `mychess/src/routes/(player)/learn/[repertoire_id]/+page.svelte`

- [ ] **Step 1:** Apply the methodology to both files, including SEO tags. `learn/+page.svelte` has **two** hand-branched pluralization sites, not one — both need proper plural-match keys: "{Your repertoire is / All {learnedCount} of your repertoires are} fully learned — keep {it/them} sharp in Practice" (a count *and* a paired pronoun, both grammar-dependent), and separately "{learnedCount} fully learned {repertoire lives/repertoires live} in Practice." `learn/[repertoire_id]/+page.svelte` also has its own count+noun site ("{attemptMistakeCount} mistake{s} this attempt") plus a session counter ("{learnedThisSession} learned this session" — no noun in the English today, but check whether natural Lithuanian phrasing wants one; if so it becomes a third plural-match key in this file).
- [ ] **Step 2:** Check `$lib/mastery/variations.ts` (or wherever `UNTAGGED_CHAPTER` is actually defined — confirm the exact module) for its literal string value, since `RepertoireVariationTree.svelte` and `VariationPicker.svelte` (translated in Task 8) both render it as a chapter-name fallback — it needs a message key too, from whichever task touches it first; leave a note in that task's commit/report for the other one.
- [ ] **Step 3:** Run `npm run check && npm run lint`, plus any colocated tests (grep for `learn*.test.ts`).
- [ ] **Step 4:** Commit: `git add "src/routes/(player)/learn" messages/en.json messages/lt.json`, message `"feat(i18n): translate the Learn flow"`.

---

### Task 6: Practice

**Precondition:** Task 4 (shared move/board components) is done.

**Files:**
- Modify: `mychess/src/routes/(player)/practice/+page.svelte`, `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`, `mychess/src/routes/(player)/practice/[repertoire_id]/mastery/+page.svelte`
- Modify: `mychess/src/lib/components/RepertoireUpdatedBanner.svelte` (plan correction — found during Task 3's review, only used by `practice/[repertoire_id]/+page.svelte`, never assigned to a task)

- [ ] **Step 1:** Apply the methodology to all three route files, including SEO tags. **This is one of the densest pluralization areas in the whole app — don't treat it as a plain string swap.** `practice/[repertoire_id]/+page.svelte` has at least four hand-branched English ternaries that each need a proper CLDR plural-match key instead of the current `count === 1 ? singular : plural` pattern: the "{learnedCount} {line is/lines are} learned, but Practice only drills a chapter..." message, the "{sessionPassed} held up{, {sessionDemoted} went back to Learn}" session-complete summary (**two independent counts in one sentence — each needs its own plural-match key**), "Re-learn {that line/those lines}", and the "{sessionPassed} held up · {sessionDemoted} back to Learn" compact variant elsewhere on the same page (same two counts, different phrasing — decide whether to reuse the same two message keys with different surrounding text, or give this second occurrence its own keys).
- [ ] **Step 2:** Translate `RepertoireUpdatedBanner.svelte`: its own hand-branched pluralization ("Your coach updated this repertoire — {lineCount} {line needs/lines need} review", with verb agreement too) plus the "Dismiss coach update notice" aria-label. `RepertoireUpdatedBanner.test.ts` asserts both the singular/plural boundary and the dismiss button — English values must match exactly.
- [ ] **Step 3:** Run `npm run check && npm run lint`, plus any colocated tests (grep for `practice*.test.ts` and `RepertoireUpdatedBanner.test.ts`).
- [ ] **Step 4:** Commit: `git add "src/routes/(player)/practice" src/lib/components/RepertoireUpdatedBanner.svelte messages/en.json messages/lt.json`, message `"feat(i18n): translate the Practice flow"`.

---

### Task 7: Drill & Time-trial

**Precondition:** Task 4 (shared move/board components) is done.

**Files:**
- Modify: `mychess/src/routes/(player)/drill/+page.svelte`, `mychess/src/routes/(player)/time-trial/+page.svelte`

- [ ] **Step 1:** Apply the methodology to both files, including SEO tags. Watch for two count strings in `drill/+page.svelte`, not just one — `"You drilled all {allMoves.length} moves!"` and `"Best chain: {bestChain} moves"` — both need plural-match keys.
- [ ] **Step 2:** Run `npm run check && npm run lint`, plus any colocated tests.
- [ ] **Step 3:** Commit: `git add "src/routes/(player)/drill" "src/routes/(player)/time-trial" messages/en.json messages/lt.json`, message `"feat(i18n): translate Drill and Time Trial"`.

---

### Task 8: Repertoires + repertoire-related shared components

**Files:**
- Modify: `mychess/src/routes/(player)/repertoires/+page.svelte`, `mychess/src/routes/(player)/repertoires/new/+page.svelte`
- Modify: `mychess/src/lib/components/PgnImportForm.svelte`, `RepertoireVariationTree.svelte`, `RepertoireDiffReview.svelte`, `RepertoirePracticeRow.svelte`, `OpeningPicker.svelte`, `VariationPicker.svelte`

- [ ] **Step 1:** Apply the methodology to both route files and all six components, including SEO tags on the route files. `PgnImportForm.svelte`'s file-input `<label>` text must stay associated with its `for`/`id` exactly as today per this repo's convention (`getByLabelText` assertions) — translate the label's visible text but don't restructure the label/input association.
- [ ] **Step 2:** Watch for count strings: `{doneCount} / {chapters...}` (a numeric ratio, not itself pluralized text — leave as-is), `{assignedStudentCount} students`, `{chapter} chapter`/`{chapter} (chapter...)`, `{fileName}. Each student`, plus `RepertoireVariationTree.svelte`'s own `· {n} {line/lines}`. **`RepertoireDiffReview.svelte` has by far the most pluralization sites of any file in this epic — at least eight — and zero test coverage, so nothing will catch a broken one automatically; read it fully rather than skimming for the count patterns already named here.** Distinct sites include: `add/reshape/retire {n} {line/lines}` (three separate messages), `leave {n} {line/lines} in the chapters you kept untouched`, `{n} learned {line/lines} will drop to review, across {affectedPlayerCount} of {assignedStudentCount} students`, `{assignedStudentCount} {student/students} assigned`, `This file does not mention {n} {chapter/chapters}. Remove {it/them}?` (a combined count+noun and count+pronoun pair, same pattern as Task 5's learn-page finding), and `{n} {line/lines}` in the rename-vs-separate-chapter dialog. Give each its own message key rather than trying to reuse one across all of them, since the surrounding sentences differ.
- [ ] **Step 3:** Run `npm run check && npm run lint`, plus every colocated test for these files (there are several — grep for `*.test.ts` next to each).
- [ ] **Step 4:** Commit: `git add "src/routes/(player)/repertoires" src/lib/components/PgnImportForm.svelte src/lib/components/RepertoireVariationTree.svelte src/lib/components/RepertoireDiffReview.svelte src/lib/components/RepertoirePracticeRow.svelte src/lib/components/OpeningPicker.svelte src/lib/components/VariationPicker.svelte messages/en.json messages/lt.json`, message `"feat(i18n): translate Repertoires"`.

---

### Task 9: Player coaches page, settings, cosmetics, badges

**Files:**
- Modify: `mychess/src/routes/(player)/coaches/+page.svelte`, `mychess/src/routes/settings/+page.svelte`, `mychess/src/routes/(player)/cosmetics/+page.svelte`, `mychess/src/routes/(player)/badges/+page.svelte`
- Modify: `mychess/src/lib/components/FideLookupCard.svelte`, `PlatformRatingsCard.svelte`
- Modify: `mychess/src/lib/coach-players.ts` (see Step 1 — `coaches.test.ts` asserts on a string that lives here, not in the route file)

- [ ] **Step 1:** Apply the methodology to all four route files and both components, including SEO tags. `coaches.test.ts` asserts `getByText('You already sent a request.')` — that string is produced by `planRequest()` in `src/lib/coach-players.ts` (a pure-logic module), not by `coaches/+page.svelte` itself. Translate it there too as part of this task, and confirm the test's assertion still passes (English value unchanged). `FideLookupCard.svelte`'s FIDE-ID input `<label>` must stay `getByLabelText`-compatible per this repo's convention — same care as Task 8's PGN label. Also in `FideLookupCard.svelte`: the age-group rank label is built by string concatenation (`` `${p.ageBracket} rank${suffix}` ``, `suffix` being `''` or `' (Europe)'`) — don't translate the fragments independently; treat each of the four real rendered forms ("{bracket} rank", "Age group rank", "{bracket} rank (Europe)", "Age group rank (Europe)") as its own message key, since Lithuanian word order won't necessarily match English's suffix-append pattern. `FideLookupCard.test.ts` asserts the exact compound strings `/^U18 rank$/i` and `/U18 rank \(Europe\)/i` — these are English-mode assertions and must keep matching, so the **English** values of these four keys must stay exactly as they are today even though the Lithuanian ones will read naturally. `cosmetics/+page.svelte` and `badges/+page.svelte` currently have no `<svelte:head>` at all (a pre-existing SEO gap, not just an untranslated one) — add one with a translated title/description as part of this task rather than leaving it missing.
- [ ] **Step 2:** Watch for count strings: `{earnedCount} / {badges...}`, `{body.count} game...` — pluralize each.
- [ ] **Step 3:** Run `npm run check && npm run lint`, plus every colocated test (`FideLookupCard.test.ts` definitely exists — confirm its assertions still pass, since it asserts on rendered rating/rank text).
- [ ] **Step 4:** Commit: `git add "src/routes/(player)/coaches" src/routes/settings "src/routes/(player)/cosmetics" "src/routes/(player)/badges" src/lib/components/FideLookupCard.svelte src/lib/components/PlatformRatingsCard.svelte src/lib/coach-players.ts messages/en.json messages/lt.json`, message `"feat(i18n): translate Coaches, Settings, Cosmetics, and Badges"`.

---

### Task 10: Tournaments

**Files:**
- Modify: `mychess/src/routes/tournaments/+page.svelte`
- Modify: `mychess/src/lib/components/tournaments/TournamentCard.svelte`, `TournamentFilters.svelte`, `TournamentCarousel.svelte`

- [ ] **Step 1:** Apply Worked Example 1 (above) to `tournaments/+page.svelte` — it covers this file's SEO tag, heading, view-toggle buttons, and empty state exactly. Additionally translate: the stale-data warning ("⚠️ Data may be outdated. Last updated: ..."), the error banner ("Error loading tournaments: {data.error}"), "← Previous"/"Next →", "Page {page} of {totalPages}" (pluralize the page count if you judge it warrants it — Lithuanian ordinals for "page N of M" don't need CLDR plural-match the way a bare count does, so a single `m.tournaments_page_of({page, totalPages})` message with both numbers interpolated is sufficient), and "No tournaments with dates in this range" (calendar view's empty state).
- [ ] **Step 2:** Translate `TournamentCard.svelte`: `statusLabel` map ("Upcoming"/"Live"/"Finished"), `tcLabel` map ("Classical"/"Rapid"/"Blitz" — "UNKNOWN" stays an empty string, not translated), and the `{tournament.player_count} players`/`Avg {tournament.average_rating}` strings — pluralize "players" (it's always plural in the English today regardless of count, same latent gap as `RepertoirePracticeRow.svelte`'s "variations learned" — fix it properly here rather than porting the always-plural behavior). These `statusLabel`/`tcLabel` maps are hand-copied identically into **three** files (`TournamentCard.svelte`, `TournamentCarousel.svelte`, `TournamentFilters.svelte`) — translate the map here first, then reuse the exact same message keys in Steps 3 and 4 rather than re-deriving the Lithuanian text three times (a mismatch between the three copies would be a visible inconsistency, e.g. the dashboard carousel and the tournaments page showing different Lithuanian words for "Live").
- [ ] **Step 3:** Translate `TournamentFilters.svelte`: "Filters", "Clear all filters", "Status"/"Time Control"/"Country"/"Date Range" section labels, the `statusOptions`/`tcOptions` label maps (same English values as `TournamentCard`'s — reuse the same message keys rather than duplicating them under a different name), the `countryOptions` array (`'Lithuania'`, `'Latvia'` — these are literal country names used as filter values sent in the URL; translate only the *displayed* label if you choose to show one, but do **not** change the underlying value strings themselves, since they're compared against DB values), the `{total} result{total !== 1 ? 's' : ''}` pluralized string, and the "From"/"To" date input placeholders.
- [ ] **Step 4:** Translate `TournamentCarousel.svelte`: the same `statusLabel`/`tcLabel` maps (reuse Task 10's Step 2 keys), `Avg {t.average_rating}`, and the "Previous"/"Page {i+1}"/"Next" `aria-label`s.
- [ ] **Step 5:** No test files exist for any of these four files today (confirmed during planning) — no test-coupling risk, but still run `npm run check && npm run lint`.
- [ ] **Step 6:** Commit: `git add src/routes/tournaments/+page.svelte src/lib/components/tournaments messages/en.json messages/lt.json`, message `"feat(i18n): translate Tournaments"`.

---

### Task 11: Games

**Precondition:** Task 4 (shared move/board components) is done.

**Files:**
- Modify: `mychess/src/routes/(player)/games/+page.svelte`, `mychess/src/routes/(player)/games/new/+page.svelte`, `mychess/src/routes/(player)/games/[game_id]/+page.svelte`
- Modify: `mychess/src/routes/(player)/games/games.test.ts` (one assertion, per Worked Example 2)

- [ ] **Step 1:** Apply the methodology to `games/+page.svelte`: SEO tag, "My Games" heading, "Upload a game" button, "No games uploaded yet.", the `{game.headers?.White ?? '?'} vs {game.headers?.Black ?? '?'}` pattern (the "vs" is the only literal text — the names are dynamic data, don't translate them, but do translate "vs" itself if there's a natural Lithuanian equivalent commonly used in this context — "prieš" is the standard Lithuanian word for "versus" in sports/games contexts), "Not yet analyzed", "Delete", and the JS `confirm("Delete this game? This can't be undone.")` dialog text. Apply Worked Example 2 exactly for the blunders/mistakes/inaccuracies line, including the `games.test.ts` fix it specifies.
- [ ] **Step 2:** Apply the methodology to `games/new/+page.svelte`: SEO tag, "← Back to My Games", "Upload a game" heading, "Which side did you play?", "White"/"Black"/"Not sure" options, "Paste PGN text" label (keep `for`/`id` association intact, per this repo's convention), "…or upload a .pgn file" label, "Choose File" button text, "…or import from Google Drive" / "Opening Google Drive…", "Selected: {fileName}", "Uploading…" / "Upload and analyze", and the inline error strings in the `<script>` block ("Could not read that file — try pasting the PGN text instead.", "Could not import from Google Drive.", "PGN is required", "Upload failed").
- [ ] **Step 3:** Apply the methodology to `games/[game_id]/+page.svelte`: SEO tag (the `{White} vs {Black} — MyChess` title — same "vs"/"prieš" treatment as Step 1), "← Back to My Games", `classificationLabel`'s "Blunder"/"Mistake"/"Inaccuracy" (note: these are the same underlying concepts as Task 11 Step 1's pluralized counts, but here they're per-move labels with no count attached — a plain key each, not plural-match), "Eval:", "Best was", "Analyzing…", "{done} / {total}" progress counter, the `analyzeError` fallback ("Analysis failed", "Could not save analysis"), "Retry", and "Moves" (the moves-list panel heading).
- [ ] **Step 4:** Run `npm run check && npm run lint`, then `npx vitest run "src/routes/(player)/games"` (covers `games.test.ts`, `new.test.ts`, `analysis.test.ts`) — confirm the one deliberately-updated assertion (Step 1) passes and nothing else broke.
- [ ] **Step 5:** Commit: `git add "src/routes/(player)/games" messages/en.json messages/lt.json`, message `"feat(i18n): translate Games"`.

---

### Task 12: Coach-side pages

**Files:**
- Modify: `mychess/src/routes/(coach)/coach/+page.svelte`, `invite/+page.svelte`, `pgn/+page.svelte`, `players/[player_id]/+page.svelte`, `repertoires/+page.svelte`, `repertoires/[repertoire_id]/update/+page.svelte`, `reports/+page.svelte`, `students/+page.svelte`

- [ ] **Step 1:** Apply the methodology to all eight files, including SEO tags where present. Watch for count strings spotted during planning: `{pendingCount} pending student...`, `{assignedStudentCount} students`, `{pr.chaptersMastered} chapter...`, `{pr.demotions} line{s} sent back to Learn`, `{pr.chaptersStale} needing re-mastery after new material`, `{filter} repertoires`, `{fileName}. Each student...`, `{point.bucket}: {point...}` — pluralize each. `player-detail`'s (`players/[player_id]/+page.svelte`) test (`player-detail.test.ts`) asserts several of these exact pluralized strings at count=2/3 (e.g. `/2 chapters mastered/`, `/3 lines sent back to Learn/`) — the English side of each plural-match key must reproduce that exact wording at those counts, or the test needs a matching update (same rule as Worked Example 2, but here the existing English is already correct, so no test change should be needed if the key's `other`/`few` English value matches verbatim). **`students/+page.svelte`'s test (`students.test.ts`) asserts `getByText('No player selected')` — this string does not exist anywhere in the current `+page.svelte` source.** Investigate before translating: either the test is already stale/wrong (in which case flag it rather than inventing a matching string just to keep it green), or the string lives somewhere not yet found (a different render branch, a shared component). Don't silently paper over this with a fabricated key.
- [ ] **Step 2:** Some of these pages likely reuse components already translated in Task 8 (`PgnImportForm`, `RepertoireVariationTree`, etc.) — don't retranslate those, just confirm the coach-side pages' own text is covered.
- [ ] **Step 3:** Run `npm run check && npm run lint`, plus every colocated test (grep for `*.test.ts` under `src/routes/(coach)`).
- [ ] **Step 4:** Commit: `git add "src/routes/(coach)" messages/en.json messages/lt.json`, message `"feat(i18n): translate coach-side pages"`.

---

### Task 13: Support page

**Files:**
- Modify: `mychess/src/routes/support/+page.svelte`

- [ ] **Step 1:** Translate the already-read content: SEO `<title>Support MyChess</title>`, "Support MyChess" heading, the two body paragraphs, "Leave a tip", and "Donation link coming soon."
- [ ] **Step 2:** Run `npm run check && npm run lint`.
- [ ] **Step 3:** Commit: `git add src/routes/support messages/en.json messages/lt.json`, message `"feat(i18n): translate the Support page"`.

---

### Task 14: Coverage check and full verification pass

**Files:** none (verification + cleanup only)

- [ ] **Step 1:** Grep every file touched across Tasks 1-13 for suspicious leftover literal English text — e.g. `grep -rn '>[A-Z][a-z]' src/routes src/lib/components` and manually skim for anything that looks like a missed hardcoded string (expect false positives from dynamic data interpolation; the point is to catch what's obviously still hardcoded).
- [ ] **Step 2:** Run the full suite: `npm test`. Expect all passing, including `games.test.ts`'s one updated assertion.
- [ ] **Step 3:** Run `npm run check && npm run lint`. Expect 0 errors from both.
- [ ] **Step 4:** Manual verification: start `npm run dev`, switch to Lithuanian via the navbar switcher, click through the dashboard, Learn, Practice, Repertoires, a coach's players list, and Tournaments — confirm translated text renders and nothing silently fell back to a raw message key (a literal `tournaments_heading` string on screen would mean a typo in the key name between `en.json` and the call site).
- [ ] **Step 5:** Spot-check pluralization: for at least one pluralized string (e.g. the games blunder/mistake/inaccuracy counts), verify counts 1, 2, 10, and 21 each render the grammatically correct Lithuanian form (`one`/`few`/`other` boundaries).
- [ ] **Step 6:** Push: `git push`.

---

## Notes

- ECO opening-name translations are a separate, not-yet-started epic (`src/lib/openings/eco-data.ts`, 500 entries) — out of scope here.
- Two dead routes found during planning (`/tournaments/[id]`, `/join/[token]`, both empty `+page.svelte`) are tracked in issue #134, unrelated to this plan.
- **Page-title key naming inconsistency (found during Task 7's code-quality review):** the Methodology above specifies `seo_<page>_title` for SEO tags, and Task 7 followed it exactly (`seo_drill_title`, `seo_time_trial_title`). Tasks 3 and 5 predate a clear read of that rule and used `<domain>_page_title` instead (`learn_page_title`, `practice_list_page_title`, `practice_repertoire_page_title`, `practice_mastery_page_title`, `learn_repertoire_page_title`). Task 7 is the compliant one; the earlier keys are the deviation. Not worth an implementer round-trip to rename now (touches already-approved, already-tested files for a cosmetic key-name-only change with zero user-visible effect) — but Task 14 should either rename the five older keys to the `seo_*` convention for consistency, or explicitly accept the mixed naming as a known wart. Decide one way in Task 14 rather than letting future tasks guess which convention to follow.
- **Deferred cosmetic item (Task 7):** the migration of `drill_best_chain_count`, `drill_all_moves_drilled_count`, and `time_trial_result_count` into whole-sentence plural-match messages dropped the original `<strong>` bold emphasis around the interpolated count (previously e.g. `Best chain: <strong>{bestChain}</strong> moves`). Restoring it cleanly requires splitting each message into plural-dependent prefix/suffix keys (Lithuanian's pre-count word also changes by case, e.g. "visą" vs "visus") — deliberately not done for a purely cosmetic loss. Pick this up in a later polish pass if it matters visually.
