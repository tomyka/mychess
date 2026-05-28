# KidChess — Design Spec

**Date:** 2026-05-28
**Status:** Design approved, ready for planning
**Author:** Brainstorming session with t.konovalovas

---

## 1. Problem & Goal

There is no easy and entertaining way for kids under 14 to learn chess openings and build custom repertoires. Existing tools (chessreps.com, Chessable) are flashcard-driven but designed for adults — they lack the gamification, mascot interaction, and friendly visual language that keeps kids coming back daily.

**Goal:** Build a web + mobile-responsive PWA where 5 kids (initial scope) can:

- Have a personal opening repertoire built from PGN uploads, chess.com / lichess sync, or coach assignment.
- Learn that repertoire through spaced repetition, with five training modes adapted from chessreps.com.
- Stay engaged daily via XP, levels, streaks, badges, avatars, quests, mascot reactions, and a friendly leaderboard.
- Be supervised by a coach (the app owner initially; later, any adult) who tracks progress, assigns repertoires, sets goals, and leaves notes.

**Non-goal (this phase):** Public sign-up, COPPA-compliant under-13 onboarding for strangers, native mobile apps. The MVP serves a known group of 5 kids invited by their coach. Public scaling is a deliberate phase-2 effort.

## 2. Users & Roles

- **Kid** (age ≈ 8-14) — learns repertoires, does daily reviews, earns XP. Signs in with their own Google account via an invite link from a coach.
- **Coach** (the app owner initially) — invites kids, uploads repertoires, sets goals, leaves notes, views dashboards. Signs in with Google.
- **Admin** (initially identical to coach) — placeholder role for future multi-coach support.

## 3. Tech Stack

| Layer            | Choice                                                                 |
| ---------------- | ---------------------------------------------------------------------- |
| Frontend         | SvelteKit 2 + TypeScript + Tailwind CSS                                |
| Board UI         | `chessground` (lichess library) + `chess.js` for rules                 |
| State            | Svelte stores + TanStack Query                                         |
| PWA              | `@vite-pwa/sveltekit` with offline shell + cached review queue         |
| Auth             | Supabase Auth, Google OAuth provider only                              |
| Database         | Supabase Postgres + Row-Level Security                                 |
| File storage     | Supabase Storage (raw PGN files)                                       |
| Background jobs  | Supabase Edge Functions on cron (daily sync, badge recalc)             |
| Hosting          | Vercel (frontend), Supabase (backend) — both free tier                 |
| Domain           | `*.vercel.app` to start; custom domain later                           |
| Analytics        | Self-hosted Umami later; nothing in v1 to keep privacy maximal         |
| SRS algorithm    | FSRS v4 (`ts-fsrs` npm package)                                        |
| Puzzle source    | lichess open puzzle DB (~5M, free CC0) seeded into Postgres            |

**Why this stack:** zero-ops, all free tier covers 5 kids and scales to thousands without changes; SvelteKit gives the same buttery mobile feel chessreps.com has; Supabase removes the need for a custom auth + DB + storage backend.

## 4. Architecture

```
┌─────────────────────────────────────────────────┐
│  SvelteKit PWA (Vercel)                         │
│  ─ Kid app: /, /train, /openings, /profile      │
│  ─ Coach app: /coach, /coach/kids/:id           │
│  ─ Offline service worker caches review queue   │
└─────────────────┬───────────────────────────────┘
                  │ HTTPS + Supabase client SDK
┌─────────────────▼───────────────────────────────┐
│  Supabase                                       │
│  ├─ Auth (Google OAuth)                         │
│  ├─ Postgres (RLS-enforced)                     │
│  ├─ Storage (PGN file blobs)                    │
│  └─ Edge Functions                              │
│     ├─ pgn-parse  (on upload)                   │
│     ├─ chess-sync (daily cron, per platform)    │
│     ├─ badge-recalc (after each session)        │
│     └─ leaderboard-snapshot (weekly cron)       │
└─────────────────────────────────────────────────┘
                  │
        External: lichess API, chess.com public API
```

Two SvelteKit layouts: `/(kid)` and `/(coach)`. Route guard reads `profiles.role` and redirects.

## 5. Data Model

All tables have `created_at timestamptz default now()` and `id uuid default gen_random_uuid() primary key` unless noted.

### Identity & permissions

- **`profiles`** — `id` (FK auth.users), `role` ('kid'|'coach'), `display_name`, `avatar_id`, `coach_id` (FK self, nullable), `daily_goal int default 15`, `weekly_xp_goal int default 500`.
- **`invites`** — `id`, `coach_id`, `token` (random url-safe string), `email` (optional, for emailing the invite), `used_by` (FK profiles, nullable), `expires_at`.

### Repertoires & moves

- **`repertoires`** — `owner_id`, `name`, `color` ('white'|'black'), `source` ('pgn_upload'|'chesscom'|'lichess'|'coach_assigned'), `pgn_file_path` (Storage ref, nullable), `is_archived bool default false`.
- **`positions`** — `id`, `fen` (unique). Shared across all repertoires for dedup.
- **`moves`** — `repertoire_id`, `from_position_id`, `to_position_id`, `san`, `uci`, `comment text`, `nag smallint[]`, `is_main_line bool`, `parent_move_id` (FK self, nullable), `depth_ply int`.

### Training

- **`reviews`** — `kid_id`, `move_id`, FSRS state: `difficulty`, `stability`, `retrievability`, `state` ('new'|'learning'|'review'|'relearning'), `due timestamptz`, `last_review timestamptz`, `lapses int`, `reps int`. Composite PK (`kid_id`, `move_id`).
- **`sessions`** — `kid_id`, `mode`, `started_at`, `ended_at`, `cards_seen int`, `correct int`, `xp_earned int`, `streak_within_session int`.
- **`review_events`** — `session_id`, `move_id`, `result` ('correct'|'wrong'|'shown'), `latency_ms`, `rating` ('again'|'hard'|'good'|'easy' — FSRS input), `played_at`. Append-only audit trail.

### Gamification

- **`kid_stats`** — `kid_id` (PK), `xp bigint`, `level int`, `current_streak_days int`, `longest_streak_days int`, `last_active_date date`, `streak_freeze_count int default 0`. Updated via trigger on `sessions` insert.
- **`badges`** — static catalog: `code` (PK), `title`, `description`, `icon`, `category`, `criteria_jsonb`.
- **`badges_earned`** — `kid_id`, `badge_code`, `earned_at`. Composite PK.
- **`quests`** — daily generated: `kid_id`, `date`, `quest_code`, `target_value`, `current_value`, `completed_at`.
- **`avatars` / `themes` / `piece_sets`** — static catalog of cosmetic items with `unlock_level` or `unlock_badge_code`.
- **`equipped_cosmetics`** — `kid_id`, `avatar_id`, `theme_id`, `piece_set_id`.

### External platforms

- **`platform_integrations`** — `kid_id`, `platform` ('chesscom'|'lichess'), `username`, `oauth_token_encrypted bytea`, `last_sync_at`. Unique on (`kid_id`, `platform`).
- **`game_history`** — `kid_id`, `platform`, `external_id`, `pgn text`, `color`, `result`, `played_at`, `book_exit_ply int`, `book_exit_move_id` (FK moves, nullable), `eco varchar(3)`. Unique on (`platform`, `external_id`).

### Coach features

- **`coach_assignments`** — `coach_id`, `kid_id`, `repertoire_id`, `assigned_at`, `due_date`, `note`.
- **`coach_notes`** — `coach_id`, `kid_id`, `body`, `read_at`.
- **`weekly_leaderboard`** — snapshot table written by cron: `coach_id`, `week_start`, `kid_id`, `xp_this_week`, `rank`.

### Puzzles

- **`puzzles`** — seeded from lichess CSV: `lichess_id`, `fen`, `moves` (solution UCI sequence), `rating`, `themes text[]`, `eco varchar(3)`.

### Row-Level Security policies (summary)

- Kids: full CRUD on rows where `kid_id = auth.uid()` or `owner_id = auth.uid()`.
- Coaches: SELECT on rows where the related `kid_id`'s `profiles.coach_id = auth.uid()`. INSERT/UPDATE on `coach_assignments`, `coach_notes`, `invites`.
- All writes to `kid_stats`, `reviews`, `sessions` go through Edge Functions or RPCs that re-check authorization to prevent client tampering with XP/streaks.

## 6. SRS Engine

**Card definition:** a `(position, kid_id)` where it's the kid's turn in their repertoire (matches `repertoires.color`).

**Algorithm:** FSRS v4 via `ts-fsrs`. Defaults targeting 90% retention. Per-card state stored in `reviews`.

**Rating mapping** (kid never sees raw FSRS labels — UI shows reactions only):

- Wrong first attempt or used hint → `again`
- Correct after >5s thinking → `hard`
- Correct in 2-5s → `good`
- Correct in <2s → `easy`

**Multiple correct moves:** if the repertoire has two acceptable continuations from the same position (e.g., main line and a variation marked as "also playable"), either is accepted; the played one drives that card's schedule.

**Queue order per session:**

1. Overdue review cards (oldest due first).
2. Learning-state cards.
3. New cards (capped by daily-goal).

The Learn mode bypasses (1)/(2) and only serves new cards. Practice mode honors (1)→(2)→(3).

## 7. Training Modes

| Mode        | Queue source                      | Hint        | End condition                       | XP rules                             |
| ----------- | --------------------------------- | ----------- | ----------------------------------- | ------------------------------------ |
| Learn       | New cards from chosen repertoire  | After 5s    | Daily new-card budget hit, or quit  | +10 first try, +5 with hint          |
| Practice    | Due reviews (FSRS)                | On-demand   | Queue empty, or quit                | +10 correct, +5 if hint, -2 wrong    |
| Drill       | Random already-learned cards      | None        | First mistake                       | +2 per card, +50 bonus at 10-streak  |
| Time Trial  | Random already-learned            | None        | 60-second timer                     | +5 per correct, +200 if 20+          |
| Puzzle      | `puzzles` filtered by ECO of kid's repertoire | None | Wrong move or solved | +15 per solved, +30 for streak of 3  |

**Negative XP guard:** session XP is never less than 0; lifetime XP can't decrease (a wrong move just doesn't add).

## 8. Gamification System

- **Levels curve:** L1=0, L2=100, L3=250, L4=500, L5=1000, then `next = prev * 1.6` rounded to 50.
- **Streak:** counted in `last_active_date`. A streak survives if the kid completes ≥1 session that meets ≥50% of daily goal. Streak freeze (auto-granted every 7th streak day, max 2 stored) protects one missed day.
- **Daily goal:** number of cards reviewed today, default 15, coach-configurable per kid (5-100).
- **Quests:** 3 daily, generated at midnight kid-local-time by Edge Function. Templates: "Review N cards", "Learn N new moves", "Hit a streak of N in Drill", "Play a Time Trial", "Solve 3 puzzles". Completion = +50 XP each.
- **Badges:** ~30 launch badges. Criteria stored as JSON evaluated by `badge-recalc` Edge Function after each session.
  - First-time: first session, first PGN upload, first level-up.
  - Streak: 3 / 7 / 30 / 100 days.
  - Mastery: all moves in a named opening at `interval >= 30 days`.
  - Volume: 100/500/1000 cards in a day; 10k lifetime.
  - Speed: Time Trial 15/25/40 correct.
  - Exploration: linked chess.com; linked lichess; 5 repertoires.
  - Social: completed a coach assignment on time.
- **Cosmetics:** 12 avatars, 6 board themes, 4 piece sets. Unlock by level or badge. Equipped via `equipped_cosmetics`.
- **Mascot ("Sir Knight"):** SVG character with 6 expression states (idle, cheer, sad, surprise, sleepy, party). State driven by recent events: cheer on correct streak, sad on wrong, surprise on level-up, sleepy if no review in 24h.
- **Sound effects:** under 200KB total, toggle in settings; defaults on; respect `prefers-reduced-motion` and an audio toggle.
- **Leaderboard:** weekly XP within the coach's kid group. Top 3 podium UI on kid's home screen. Weekly snapshot stored to prevent late-week swings from looking strange after the week ends.

## 9. chess.com / lichess Sync

### Linking

- **lichess:** OAuth 2.0 PKCE — `scope=preference:read challenge:read`. Token stored encrypted.
- **chess.com:** kid enters their username; chess.com public API doesn't require auth for reading own published games.

### Daily cron (`chess-sync` Edge Function)

For each `platform_integrations` row:

1. Fetch new games since `last_sync_at` (lichess: `/api/games/user/{user}?since=...&pgnInJson=true`; chess.com: monthly archives endpoint).
2. Upsert into `game_history` keyed by (`platform`, `external_id`).
3. Walk the PGN against the kid's matching-color repertoires; record `book_exit_ply` and `book_exit_move_id`.
4. Update `platform_integrations.last_sync_at`.

### Repertoire compliance

- After sync, queue an in-app notification per game where kid exited book early: "In your game vs X, you played Bf4 — your repertoire says Bg5."
- If opponent played a move not in repertoire and it appears in **3+ games** within 30 days, prompt: "Add this line to your repertoire?" with an inline mini-board.

### Opening stats

- Materialized view `kid_eco_stats` recomputed nightly: per (kid, ECO code) win rate, games played, book accuracy %.

### Manual sync

- Button on kid's profile: "Sync now" — invokes Edge Function on demand (rate-limited to 1/minute per kid).

## 10. Coach Features

- **Become a coach:** any signed-in user can toggle "I'm a coach" in settings until they have invited a kid; after that, role is locked to prevent kids accidentally becoming coaches.
- **Invite flow:** `/coach/invite` → generates token → `https://kidchess.app/join/{token}` link. Kid clicks → Google sign-in → automatic attach with `coach_id` set. Token single-use, 7-day expiry.
- **Dashboard (`/coach`):** card per kid with avatar, streak fire, today's progress ring, XP this week, "last active" relative time, alert chips (streak about to break, missed goal 3 days, awaiting first session).
- **Kid detail (`/coach/kids/:id`):** repertoires owned, sessions table, XP curve chart, badges earned, ECO performance table, notes thread.
- **Assign repertoire:** coach uploads PGN → picks kid(s) → adds optional note + due date → kid sees it pinned in their "From Coach" rail with subtle "★" badge.
- **Set goals:** edit `profiles.daily_goal` and `profiles.weekly_xp_goal` for any of their kids.
- **Notes:** short message; appears as Sir-Knight speech bubble on kid's home until tapped to acknowledge; `read_at` then set.

## 11. Auth & Permissions

- Sign in only via **Google OAuth** through Supabase.
- New users land on `/welcome`, choose Kid or Coach.
  - Kid: must enter invite code (or arrived via `/join/{token}`).
  - Coach: free to proceed; first kid invite creates the relationship.
- **RLS:** detailed policies per table; tests written against pgTAP in CI.
- **Sensitive writes** (XP, level, badges, FSRS state) go through SECURITY DEFINER Postgres functions so the client can't fake them.
- **Account deletion** endpoint cascades all rows owned by the user; PGN files in Storage purged.
- **Data export** endpoint produces a zip: profile JSON, all repertoires as PGN, sessions CSV, game history.

### Safety / safeguarding

- No public profiles, no chat between users, no in-game social, no external links opened from in-app content.
- Mascot speech is from a curated, static string table — no LLM output to kids.
- The leaderboard is bounded to the coach's own kids (never global) to prevent stranger contact.

## 12. PGN Upload Flow

1. Kid (or coach) clicks "Upload PGN" → file picker (drag-drop also accepted).
2. File uploaded to Supabase Storage at `pgns/{user_id}/{uuid}.pgn`.
3. Edge Function `pgn-parse` triggered:
   - Validate with `chess.js` (`load_pgn`); on invalid, return friendly error to UI.
   - Walk the move tree depth-first; dedupe positions by FEN; insert `moves` rows.
   - Detect mainline vs. variations from PGN tree structure.
   - Preserve comments and NAGs.
   - Insert empty `reviews` rows for the new kid (`state='new'`).
4. UI shows preview: count of unique positions, mainlines, variations; collapsible tree of first 5 mainlines.
5. Confirm → repertoire flips from `is_draft` to live; kid can start training.
6. If repertoire is large (>500 positions), show a warning; if huge (>2000), refuse and ask coach to split.

## 13. Mobile / PWA Strategy

- **Mobile-first responsive layouts** at three breakpoints: phone (< 640px), tablet (640-1024), desktop (> 1024).
- **PWA manifest** + maskable icons → installable on iOS Safari and Android Chrome.
- **Service worker** caches:
  - App shell (instant load).
  - Last fetched review queue (last 100 cards) so a session works offline; results queued and synced when online.
  - Static assets, board pieces, mascot SVGs.
- **Touch-friendly board:** chessground tap-to-move + drag-to-move; large tap targets; haptic feedback via Vibration API on capture / check / win.
- **No native apps** for v1; if needed later wrap PWA in Capacitor for App Store / Play Store.

## 14. Roadmap

| Phase | Weeks | Scope                                                                                  |
| ----- | ----- | -------------------------------------------------------------------------------------- |
| A     | 1-6   | Auth, profiles, coach role, invites, PGN upload, repertoire tree, Learn + Practice modes, FSRS, basic gamification (XP/level/streak/daily goal), PWA shell, mobile UI, coach view-only dashboard. |
| B     | 7-10  | Drill, Time Trial, mascot animations, 30 badges, avatars + themes, mini-leaderboard, quests, coach goal-setting + notes + repertoire assignment. |
| C     | 11-14 | chess.com sync, lichess sync, game history viewer, repertoire compliance, auto-add-line suggestions, puzzle mode (lichess DB seeded), ECO stats, weekly leaderboard snapshots. |

Phase A is shippable to the 5 kids on its own and tests whether daily engagement materializes before we invest in B and C.

## 15. Open Questions / Phase-2 Concerns

- **Public scaling:** explicit parental consent flow (digitally-signed parent email), COPPA age gate, captcha, abuse / spam protections, hosting upgrade path.
- **Native apps:** if engagement is high, wrap in Capacitor and publish.
- **Multi-coach orgs:** chess academies wanting one coach-admin and many sub-coaches.
- **Engine integration:** Stockfish.wasm for "what if I'd played differently" replay in game history. Defer to phase 4.
- **Course-style content:** prebuilt opening courses with personality (the chessreps moat). Can be added in phase 4 after PGN-driven flow proves itself.

## 16. Testing Strategy

- **Unit:** SRS scheduler (against published FSRS test vectors), PGN parser (against a corpus of 50 known PGNs), XP/level math.
- **Integration:** RLS policies via pgTAP — must demonstrate kid-A can't read kid-B's data; coach-X can read their kids and only theirs.
- **E2E:** Playwright — invite-redeem flow, PGN upload + train one card, Time Trial session, chess.com sync (mocked API).
- **Manual UAT:** the 5 kids use it for 2 weeks; coach reviews metrics; iterate.

## 17. Success Metrics

- **Engagement:** ≥4 of 5 kids open the app ≥5 days/week after 2 weeks.
- **Retention:** ≥3 of 5 kids keep a 14-day streak.
- **Volume:** ≥80 review cards/kid/week.
- **Quality signal:** median FSRS retrievability across all kids stays > 0.85.
- **Coach utility:** coach logs in ≥3 times per week.

---

*End of spec.*
