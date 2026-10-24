# S6 Training: design

Issue #256 (epic #250). Slice plan: `2026-10-16-m1-slices-plan.md`, row S6.
Brainstormed with the owner on 2026-10-23. Needs S3 (own repertoires) and
S5 (assigned repertoires), both done. The pure training rules already exist
in `packages/chess/src/training/` (S2): FSRS wrapper, learn steps,
"I know this", queue, mastery, weak spots, reconciliation.

## The rulings applied

| Ruling | What it means here |
| --- | --- |
| R-22, R-55 | A new Move is learned after its Learn pass: arrow, then one blind retest; a wrong retest repeats the arrow. Then its first Review is scheduled |
| R-53 | One Review per Player + Move key (position + SAN), shared by every Repertoire that holds the Move |
| R-54 | Different answers in the same position are trained in context: each item is shown inside one Repertoire and expects its Move; a "two answers" notice; nothing blocked |
| R-58 | "I know this" on a Move, line or Chapter skips the Learn pass; first Review tomorrow; the Coach sees skipped Moves (S7 shows them) |
| R-59 | After a Lapse the expected Move is shown with an arrow and must be played; the Lapse is recorded once |
| R-60 | Results that fail to save queue locally and retry in the background; the drill continues; a banner shows unsynced results |
| R-61 | A hint highlights the piece to move and counts as a Lapse (FSRS Again) |
| R-62 | A review session is 20 Due Moves by default (setting 10-100) with "continue"; new Moves have a separate daily limit (default 10) |
| R-76, R-78 | Target retention 90%; a Lapse keeps the FSRS relearning step, and those repeats count toward the session size |
| R-44, R-46, R-130 | Reviews of Moves no longer held are dormant; a paused Assignment adds no Reviews and no new Moves |
| R-129 | An Assignment is done when every own-side Move is learned (Learn pass or "I know this") |

## New rulings (owner, 2026-10-23)

- **R-142** Review runs at two scopes: "today's review" on home covers every
  Repertoire the Player trains (most urgent first), and each Repertoire page
  starts a review of that Repertoire only. Session size and the daily
  new-Move limit are per Player, not per Repertoire.
- **R-143** A review item opens at its position with the line so far in the
  panel. After a correct answer the opponent's reply is played; if the next
  own Move on that line is also in the session it is asked at once,
  otherwise the next item loads.
- **R-144** The Learn pass goes through a line twice: first from the start
  with arrows on new Moves (opponent Moves automatic, already-learned own
  Moves played by the Player ungraded), then the same line blind. A wrong
  new Move in the blind pass goes back to its arrow, then the retest
  continues. The daily limit may cut a line; it continues the next day.
- **R-145** New Moves started from home come from Assignments with a
  deadline (earliest first), then other Assignments, then own Repertoires;
  within a Repertoire, in line order. Started from a Repertoire page, only
  that Repertoire.
- **R-146** Players set the session size (10-100, default 20) and new Moves a
  day (0-50, default 10; 0 means review only). The day runs midnight to
  midnight in the Player's time zone.
- **R-147** "I know this" on a line or Chapter asks for confirmation with the
  Move count. "Learn again" on the same scopes returns skipped Moves that
  were never reviewed to "to learn". Skipped Moves do not count toward the
  daily new-Move limit.

## Lead decisions

1. **The server grades** (brainstorm approach 1). The client judges each
   answer at once against the expected Move (it has the graph; the
   Repertoire is the Player's own or assigned to them) and sends an outcome
   (`pass`, `lapse`, `hint`) or a learn completion. The server applies
   `grade()` / `startReview()`; the client never sends FSRS state.
2. **Every result carries a client-made `resultId` and its `answeredAt`.**
   The server records each `resultId` once, so a retried batch is a no-op.
   `answeredAt` is clamped to `[now - 7 days, now]` and results for one key
   apply in `answeredAt` order; a result older than the Review's last
   graded time is logged and not applied.
3. **The offline queue is localStorage**, one list per Account, flushed on
   every new result, on `online`, on page show and every 30 s while
   non-empty. The banner shows the unsynced count and a "try now" button.
   A result the server refuses as invalid (not held, bad key) is dropped
   from the queue and logged; it is not retried forever.
4. **Learn-pass progress is not stored.** A Move becomes a Review only when
   its blind retest passes (`learned_at`) or by "I know this"
   (`skipped_at`). Leaving mid-pass loses only the unfinished line's
   progress, which matches a "seen" state having no schedule.
5. **Dormant is read-time.** Reviews are filtered by `heldKeys` of the
   Player's current training Repertoires (`trainingRepertoires`, S5); no
   dormant flag is written. A Review whose Move comes back resumes as it was.
6. **"Two answers" is found at queue time**: for an item's position, the
   other held Repertoires that play a different SAN there. The panel names
   them. For a Move shared by several Repertoires (same key), the item is
   shown in the first Repertoire by the R-145 order.
7. **"Learned today"** counts Reviews whose `learned_at` falls on the
   Player's current day; skipped ones are excluded (R-147).
8. **The S5 placeholder `NOTHING_LEARNED` goes**: the Assignment done rule
   and the coach rows use the Player's learned set (learned or skipped).

## Design

### Chess (`packages/chess/src/training/`)

- **`learnPlan(graph, learned, limit)`**: the lines that hold the next up to
  `limit` new own Moves, in line order, each as a sequence of steps tagged
  `opponent`, `known` (ungraded) or `new`. Shared positions already learned
  are not taught again (U1-M1-4).
- **`learnSession`**: a pure state machine over a plan for R-144: arrow pass,
  blind pass, wrong new Move back to its arrow, emits `learned(key)` when a
  Move's blind retest passes.
- **`reviewSession`**: a pure state machine over a queue for R-143, R-59 and
  R-61: chaining, lapse then play-the-arrow, hint, "continue" (`exclude`
  already in `buildQueue`); emits one outcome per item.
- **`buildQueue`** gains the R-145 order (Repertoires come in already
  ordered by the caller) and the per-Player limits from settings.
- **`twoAnswers(position, repertoires)`** for decision 6.
- **`knowThis` / `learnAgain(scope, reviews)`**: `learnAgain` returns the keys
  whose Review is skipped and never graded.

### Domain (`packages/domain`)

- **`TrainingSettings`** with zod bounds (session 10-100, new a day 0-50) and
  defaults; message keys for refusals.
- **`acceptResult(review, result, now)`**: the clamp and ordering rule of
  decision 2 as a value: `apply`, `stale` or a refusal.
- **`canTrain(player, repertoireId, facts)`**: a Player trains a Repertoire
  that is their own, or effectively assigned and not forked by them (the set
  `trainingRepertoires` already returns); paused Repertoires train no new
  Moves and add no Reviews. S5 left this as a query only; S6 makes it a
  domain decision the endpoint checks.
- **`TRAINING_RATE_LIMIT`** in `rate-limit.ts` beside `IMPORT_RATE_LIMIT`,
  counted with `countRequest`.
- **`playerDay(now, timeZone)`**: the start and end of the Player's day.

### Database (`packages/db`)

- `reviews`: `player_id`, `move_key`, FSRS card fields (due, stability,
  difficulty, elapsed and scheduled days, reps, lapses count, state,
  last_review), `lapse_times timestamptz[]`, `learned_at`, `skipped_at`,
  `created_at`, `updated_at`; primary key (`player_id`, `move_key`); index on
  (`player_id`, `due`).
- `review_results`: `result_id uuid` primary key, `player_id`, `move_key`,
  `repertoire_id`, `kind` (`learned`, `pass`, `lapse`, `hint`),
  `answered_at`, `applied boolean`, `received_at`. Deleted with the Account;
  listed in the data export (R-40).
- `accounts` gains `session_size` and `new_per_day` with the defaults.
- Repositories: `loadTrainingState(player, scope)` (repertoires in R-145
  order, held reviews, learned today, settings);
  `recordResults(player, batch)` in one transaction under a row lock on
  each touched Review; `markKnown` / `learnAgain(player, scope)`;
  `learnedKeys(player)` for the done rule.

### Web (`apps/web`)

- **Home "Today" block**: due count, estimated minutes (8 s per Move, a
  tunable constant), "Start review", "Learn N new" (N within today's
  remaining limit).
- **Repertoire page**: the same two buttons for that Repertoire; "I know this"
  and "Learn again" on a Move, line and Chapter, with the R-147 confirm.
- **Training route** (slug from i18n-content), `?mode=review|learn` and an
  optional Repertoire: the screen of `docs/design/training-screen.md`. The
  Error case 2 is redrawn as the R-60 banner (#256). Hint button in review.
  The "two answers" notice in the panel. Done state with counts and the
  learned / due / to-learn bar.
- **Results endpoint**: `POST /api/training/results`, zod-parsed batch of at
  most 200 results, authenticated, rate limited (`TRAINING_RATE_LIMIT`);
  answers per `resultId`: `applied`, `stale`, `duplicate` or refused.
- **Settings**: the two limits.
- All text through the catalogues; i18n-content names the new terms.

## Error handling

- Session load fails: Error case 1 of the design (try again / back).
- Save fails: queue, banner, continue (R-60). A refused result is dropped
  and logged with its reason, never the move list.
- The Repertoire changes during a session (coach edit): results for keys no
  longer held are refused as `notHeld` and dropped; the session keeps going.

## Testing

- Chess: unit and property tests for `learnPlan`, the two session machines,
  `twoAnswers`, `learnAgain`.
- Domain: settings bounds, `acceptResult` clamp and ordering, `playerDay`
  across DST.
- DB (Testcontainers): idempotent and out-of-order batches, concurrent
  batches on one key, dormant filtering, learned-today across the day
  boundary, done rule via learned keys, cascade on account delete.
- Web: component tests for the drill and the offline queue (fail, banner,
  retry, drop on refusal).
- E2E: U1-M1-2, U1-M1-3, U1-M1-4, G-M1-4, D-M1-3, D-M1-5, D-M1-7 and a dropped
  connection that loses no result.

## Out of scope

Free play (M2), weak-spot dashboard (M2), the coach's view of progress and
skipped Moves (S7), notifications (M2), true offline drilling (R-7).
