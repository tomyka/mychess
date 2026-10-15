# Rename "Kid" → "Player" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every "kid" reference to "player" across code and DB schema so nothing named "kid" remains.

**Architecture:** Pre-production, so schema is reborn player-native: rewrite the four migrations that contain "kid" via a case-sensitive substring replace, `git mv` the three "kid"-named route directories, and apply the same substring replace across `src/`. A prior audit confirmed every `kid` occurrence in `src/` and `supabase/migrations/` is an intended domain reference (no false substrings like "skid"/"kidney"/"kidney"), so a blanket `kid→player` / `Kid→Player` / `KID→PLAYER` replace is safe and complete. Verification gate: `grep -ri kid src/ supabase/` returns nothing, tests green.

**Tech Stack:** SvelteKit 2, Supabase (Postgres), Vitest, git, perl.

**Working directory:** all commands run from `mychess/` unless noted. Repo root is its parent.

**Spec:** `docs/superpowers/specs/2026-07-03-rename-kid-to-player-design.md`

**Why not classic TDD:** this is a behaviour-preserving rename. The acceptance test is the existing suite staying green plus the "zero `kid` remaining" grep — there is no new behaviour to test-drive. Each task ends by verifying, and the whole rename lands in one commit (it only makes sense complete).

---

## Task 1: Sanity-check that every "kid" is intentional

**Files:** none (read-only audit).

- [ ] **Step 1: List every kid occurrence and eyeball it**

Run (from `mychess/`):
```bash
grep -rin "kid" src/ supabase/migrations/ | grep -viE "kid_id|kid_stats|kids|kidId|kid_name|kidName|p_kid_id|v_kid_id|_kid_|'kid'|\(kid\)|\[kid_id\]|Kids?|coach/kids"
```
Expected: **no output**. Every match is one of the known intended forms (column, table, role literal, policy name, route, identifier, UI text). If any *unexpected* line appears (e.g. a word like "skid" or "kidney"), STOP and report it — the blanket replace in later tasks would corrupt it. (Prior audit: none exist.)

- [ ] **Step 2: Record the baseline counts**

Run:
```bash
grep -ric "kid" src/ supabase/migrations/ | grep -v ':0' | sort
```
Expected: the four migrations (`0001`,`0002`,`0003`,`0005`) plus ~30 `src/` files. Note these — Task 5 confirms they all reach zero.

No commit (read-only).

---

## Task 2: Rename the three "kid" route directories

**Files (rename via git mv):**
- `src/routes/(kid)/` → `src/routes/(player)/`
- `src/routes/(coach)/coach/kids/` → `src/routes/(coach)/coach/players/`
- `src/routes/(coach)/coach/players/[kid_id]/` → `src/routes/(coach)/coach/players/[player_id]/`

- [ ] **Step 1: Move the route group**

Run (from `mychess/`):
```bash
git mv "src/routes/(kid)" "src/routes/(player)"
```

- [ ] **Step 2: Move the coach sub-routes**

Run:
```bash
git mv "src/routes/(coach)/coach/kids" "src/routes/(coach)/coach/players"
git mv "src/routes/(coach)/coach/players/[kid_id]" "src/routes/(coach)/coach/players/[player_id]"
```

- [ ] **Step 3: Verify the moves**

Run:
```bash
ls -d "src/routes/(player)" "src/routes/(coach)/coach/players/[player_id]"
```
Expected: both paths exist. Route groups in parentheses don't affect URLs; the `[player_id]` param folder changes the param name (handled by the content replace in Task 4).

No commit yet (kept with the content rename in Task 5).

---

## Task 3: Rewrite the four migration files

**Files:**
- Modify: `supabase/migrations/0001_core_tables.sql`, `0002_rls.sql`, `0003_rpcs.sql`, `0005_phase_b.sql`

The substring replace handles every case simultaneously because the tokens nest cleanly: `kid_id→player_id` also fixes `p_kid_id`/`v_kid_id`; `kid_stats→player_stats` also fixes `sync_kid_stats→sync_player_stats`; policy names (`_kid_`, `Kids …`), the role literal `'kid'`, and unique/PK column lists all contain `kid`/`Kid`.

- [ ] **Step 1: Apply the replace to the migrations**

Run (from `mychess/`):
```bash
git ls-files 'supabase/migrations/*.sql' | xargs perl -pi -e 's/kid/player/g; s/Kid/Player/g; s/KID/PLAYER/g'
```

- [ ] **Step 2: Verify zero "kid" remains in migrations**

Run:
```bash
grep -rin "kid" supabase/migrations/ ; echo "exit=$?"
```
Expected: no lines, `exit=1` (grep found nothing).

- [ ] **Step 3: Spot-check the critical transforms**

Run:
```bash
grep -rniE "player_stats|player_id|role in \(|sync_player_stats|'player'" supabase/migrations/0001_core_tables.sql supabase/migrations/0003_rpcs.sql supabase/migrations/0005_phase_b.sql | head -30
```
Expected: `role in ('player','coach')`, `create table public.player_stats`, `player_id` columns, function `sync_player_stats`, `on conflict (player_id)`. Confirm no logic changed — only identifiers.

No commit yet (Task 5).

---

## Task 4: Rewrite all "kid" references in `src/`

**Files:** all tracked `src/` source files (~30 contain "kid").

- [ ] **Step 1: Apply the replace to source**

Run (from `mychess/`):
```bash
git ls-files src/ | grep -E '\.(ts|svelte|js)$' | xargs perl -pi -e 's/kid/player/g; s/Kid/Player/g; s/KID/PLAYER/g'
```
This updates: `.from('kid_stats')`→`player_stats`, `.eq('kid_id',…)`/`kid_id:`/`.select('… kid_id …')`→`player_id`, `.rpc('sync_kid_stats',…)`→`sync_player_stats`, `.rpc(…, { p_kid_id })`→`{ p_player_id }`, `role !== 'kid'`/`role: 'kid'`→`'player'`, identifiers (`kidId`,`kidIds`,`kid_name`,…), `params.kid_id`→`params.player_id`, `/coach/kids/`→`/coach/players/` hrefs, and UI text (`Kid`/`Kids`→`Player`/`Players`).

- [ ] **Step 2: Verify zero "kid" remains in src**

Run:
```bash
grep -rin "kid" src/ ; echo "exit=$?"
```
Expected: no lines, `exit=1`.

- [ ] **Step 3: Spot-check the RPC named-arg keys and role guards**

Run:
```bash
grep -rniE "\.rpc\('(sync_player_stats|update_streak|update_xp_and_level|increment_new_cards|update_weekly_leaderboard|submit_session_result)'|p_player_id|role !== 'player'|role: 'player'|from\('player_stats'\)" src/ | head -40
```
Expected: RPC calls use the renamed function name and `{ p_player_id: … }` keys; guards read `'player'`; `player_stats` table used. Confirm no `p_kid_id` key survives (that would silently pass `undefined`).

No commit yet (Task 5).

---

## Task 5: Verify green and commit the rename

**Files:** none new (verification + commit).

- [ ] **Step 1: Regenerate types and type-check**

Run (from `mychess/`):
```bash
npm run check 2>&1 | tail -5
```
Expected: `svelte-kit sync` regenerates `$types` for the renamed routes; error count is the **known pre-existing set** only (`hooks.server.ts`, `lib/supabase/client.ts`, `auth/**`, `api/fide/import`, `api/tournaments/scrape`). No *new* errors, and none referencing missing `kid`/`player` symbols. If a new error appears, fix it (it will be a spot the replace changed a symbol used elsewhere that also needed renaming — grep and fix).

- [ ] **Step 2: Run the full test suite**

Run:
```bash
npx vitest run 2>&1 | tail -5
```
Expected: all tests pass (same count as before, e.g. 158). Test files with `kid`-named vars/fixtures were renamed in Task 4 so they stay consistent.

- [ ] **Step 3: Final zero-kid gate**

Run (from `mychess/`):
```bash
grep -rin "kid" src/ supabase/migrations/ ; echo "exit=$?"
```
Expected: no output, `exit=1`. This is the definition of done for the rename.

- [ ] **Step 4: Commit the whole rename**

Run (from repo root):
```bash
git add -A
git commit -m "refactor: rename Kid -> Player across code and DB schema"
```
(Single atomic commit — the route moves, migration rewrites, and source replace only make sense together.)

---

## Task 6: Operational reset (user-run — no code)

The agent cannot reach the database. After Task 5 is merged, the user runs:

- [ ] **Step 1: Reset the database** so the rewritten migrations run from scratch.
  - Local/linked CLI: `supabase db reset` (drops and re-applies all migrations).
  - Or on the Supabase project: drop the public schema / recreate, then apply all migrations (`supabase db push` against a clean DB, or run each migration in the SQL editor in order).
- [ ] **Step 2: Re-run the FIDE import** — GitHub Action *FIDE monthly import* (or `npm run fide:import`) to repopulate `fide_players`.
- [ ] **Step 3: Re-create your profile** via the welcome flow (role now stored as `'player'`).
- [ ] **Step 4: Smoke test** — player dashboard loads (stats/quests/leaderboard); submit a drill/review (exercises `submit_session_result`, `sync_player_stats`, `update_weekly_leaderboard`); open a coach's view of a player at `/coach/players/<id>`.

---

## Self-Review Notes

- **Spec coverage:** migration rewrites — Task 3 (0001/0002/0003/0005 per spec); route/coach renames — Task 2; code transforms (tables/columns/RPC names+named args/role literals/identifiers/UI) — Task 4; reset + reimport + smoke — Task 6; "zero kid" done-gate — Tasks 1/3/4/5. All spec sections mapped.
- **Placeholder scan:** every step has an exact command + expected output; no TBD/vague steps.
- **Consistency:** the substring-nesting is verified in Task 3 Step 3 and Task 4 Step 3 (e.g. `sync_kid_stats` becomes `sync_player_stats` via the `kid_stats` token; `p_kid_id` via the `kid_id` token). The `grep … exit=1` gate is used identically in Tasks 3/4/5.
- **Risk control:** Task 1 pre-audits for false-positive substrings before any destructive replace; Task 4 Step 3 explicitly hunts stale `p_kid_id` RPC keys (the spec's top risk).
