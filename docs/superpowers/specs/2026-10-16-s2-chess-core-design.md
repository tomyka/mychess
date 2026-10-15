# S2 Chess core: design

Issue #252 (epic #250). Slice plan: `2026-10-16-m1-slices-plan.md`, row S2.
Approved in brainstorming with the owner on 2026-10-16.

## The rulings applied

| Ruling | What it means here |
| --- | --- |
| R-19 | A repertoire is one side with chapters; moves are keyed by position, so transpositions merge |
| R-22, R-55 | Learn pass (arrow, then one correct blind retest), then FSRS review per player move |
| R-23, R-44, R-53 | Review state is per player, position and move; reconciliation works on those keys; removed keys go dormant |
| R-54 | Different answers in one position live in different repertoires; each review is shown in one repertoire's context |
| R-56 | Mastered: every move learned and retrievability >= 0.9 today. Weak spot: 2+ lapses in 30 days or retrievability < 0.7 |
| R-58 | "I know this" skips the learn pass; the first review is due tomorrow |
| R-61, R-62 | A hint counts as a lapse; sessions hold 20 due reviews, and 10 new moves a day |
| R-63 to R-66 | Chapter naming order; skip broken games with a report; keep arrows and circles; chapter intro; limits 2 MB, 200 games, depth 64 |
| R-29, R-74 | ECO data and Lithuanian names ported from v1; the glossary's terms |

## Owner answers in this brainstorm

- **Retention** (R-76): FSRS target retention is 90%, fixed for every player
  in M1. A player setting can follow without data changes.
- **Approach**: immutable values plus pure functions (approach A below).

## Lead decisions

- Generated opening data lives in `packages/chess/src/openings/data/`, with
  the generators in `packages/chess/scripts/`. A package may not import from
  the repo root, so this replaces `data/openings/` in the role docs. The
  Lithuanian name source stays owned by `i18n-content`, who edits the
  generator input.
- A second player move at the same position in one repertoire is refused by
  the builder. In a PGN import it is reported as skipped ("second answer at
  move N"), and the first one is kept.
- Time is always passed in (`now`); nothing in `packages/chess` reads the
  clock.
- `fast-check` is added as a dev dependency of `packages/chess` for property
  tests. `ts-fsrs` becomes a dependency.

## Design

Approach A: everything is plain readonly data, and each module exposes
functions that return new values or a `Result` refusal. Later slices store
these values as they are; domain aggregates with methods start in
`packages/domain` from S4.

### `repertoire/`

- `RepertoireGraph`: `side`, `chapters`, `moves`.
- A move is keyed by `(fromKey, san)` and has `from`, `to`, `san`, `uci`,
  `arrows`, `circles`.
- A chapter has an `id`, a name source (`custom | eco | header | index`), an
  `intro` and a `rootKey`.
- `isPlayerMove(graph, move)`: the side to move at `from` is the repertoire's
  side. Only player moves get review cards; opponent moves branch the tree
  and are played automatically in training.
- `lines(graph, chapterId)`: every start-to-leaf line.
- Builder edits: `addMove`, `removeMove` (also removes whatever becomes
  unreachable), `setArrows`.
  - `addMove` refuses an illegal move (`repertoire.illegalMove`).
  - It also refuses a second player move at the same position
    (`repertoire.secondAnswer`).
  - Notes are stored by later slices, keyed by position and move; they are
    not part of the graph.

### `pgn/` (extends #241)

- `importPgn(text, side)` returns `{ graph, skipped }`.
  - `skipped` lists `{ game, reason }` for each broken game, and for each
    second answer.
  - A file with no valid game is refused.
- Limits are checked before parsing: 2 MB, 200 games, variation depth 64.
  Breaking one returns a refusal naming the limit
  (`pgn.tooLarge | pgn.tooManyGames | pgn.tooDeep`).
- `[%cal]` and `[%csl]` become arrows and circles on the move they annotate.
- A comment before a game's first move becomes the chapter's `intro`.
- `exportPgn(graph)` writes one game per chapter, with arrows, circles and the
  intro. It is used by the GDPR export (R-40).

### `openings/`

- The ECO table (lichess chess-openings, CC0) and the Lithuanian names
  (šachmatai.lt) are ported from v1 together with their generators, and
  covered by the v1 coverage test.
- `classify(moves)` walks a chapter's main line and returns the deepest ECO
  match.
- `chapterName(chapter, locale)` returns, in order:
  - the custom name;
  - the ECO name in the locale (LT names for `lt`);
  - the header name from #241's rule;
  - `{ key: 'chapter.untitled', n }` for the UI to translate.

### `training/schedule`

- `ReviewKey = (positionKey, san)`, held per player.
- A wrapper over `ts-fsrs` with retention 0.9.
- `startReview(now)` makes a card after the learn pass or "I know this"; the
  first review is due the next day.
- `grade(card, outcome, now)`:
  - `correct` maps to Good;
  - `lapse` and `hint` map to Again, with the lapse time appended to the
    card's lapse history.

### `training/learn`

- The learn-pass state machine: `shown` (arrow) -> `asked` (blind) ->
  `learned`. A wrong blind answer goes back to `shown`.
- `buildQueue(input, now)` takes:
  - the repertoires with their context ids;
  - the player's cards;
  - the paused repertoires;
  - the limits (20 reviews, 10 new moves a day, new moves already learned
    today).

  It returns due reviews and new moves. Each item carries the repertoire it
  is shown in, so a position with two answers is reviewed in each context
  (R-54).

### `training/progress`

- `mastered(keys, cards, now)` for a line or a chapter.
- `weakSpots(cards, now)`, ranked by lapses in the last 30 days.
- `reconcile(previousKeys, currentKeys, cards)` returns:
  - `kept`: cards whose key still exists;
  - `toLearn`: new keys without a card;
  - `dormant`: cards whose key is gone. They are kept and resume if the key
    returns.

## Testing

- Unit tests on real positions: transpositions, en passant (keys from #241),
  castling rights, promotion, and PGNs with nested variations, NAGs, arrows
  and comments.
- Property tests (fast-check):
  - export then import gives the same graph;
  - `reconcile` never drops a card whose key exists;
  - `buildQueue` never exceeds its limits;
  - `grade` keeps `due` after `now`.
- Persona repertoires: every line in `docs/personas/*.md` imports, and the
  main lines classify to the opening the persona doc names.
- The mutation threshold applies.

## Done means

- All modules above are in `packages/chess`, exported from its entry, with
  tests.
- `node quality/gate.mjs check` and CI are green; mutation on the changed
  files is above the threshold.
- The persona repertoires import cleanly.
- The architect's `mp-code-review` findings are resolved.
- The role docs say `packages/chess/src/openings/data/` instead of
  `data/openings/`.
