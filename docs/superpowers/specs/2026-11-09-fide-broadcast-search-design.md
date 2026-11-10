# FIDE ID broadcast game search

Issue #316. Opponent preparation: given any FIDE ID, list that player's over-the-board games that Lichess broadcast.

## The rulings applied

- R-171: any FIDE ID can be searched; the purpose is preparing for an opponent.
- R-172, R-185: found games are listed (date, event, opponent, colour, result, opening) with a link to each game on Lichess; they are not Imported games (no Deviation, no coach visibility). The in-app board viewer is a later issue.
- R-173, R-183: the search covers the last 12 published months of the Lichess broadcast dumps (`https://database.lichess.org/broadcast/list.txt`).
- R-184: the server keeps an index per processed month, built only when a search needs that month; the first search of a month runs in the background with progress; later searches are instant.
- R-186: any signed-in account can search.
- R-180: English UI; R-179: new text in both catalogues.

## Findings this rests on (2026-11-09)

- `lichess.org/fide/<id>` refuses automated requests (403); not used, and never worked around.
- The Lichess API has no "broadcasts by FIDE player" endpoint. `GET https://lichess.org/api/fide/player/<id>` returns the player's name, federation and ratings.
- Each monthly dump is `lichess_db_broadcast_YYYY-MM.pgn.zst` (about 18 MB compressed, about 28,000 games); headers carry `WhiteFideId` / `BlackFideId`, `White`, `Black`, `Date`, `Result`, `ECO`, `Opening`, `BroadcastName`, `GameURL`. Node 24's `zlib.createZstdDecompress` streams it; no new dependency.

## Lead decisions

1. **What the index holds:** per game with at least one FIDE ID: month, game URL (unique), white and black FIDE IDs (nullable), white and black names, date, result, ECO, opening name, event (BroadcastName). Moves are not stored. A `broadcast_months` row per month: state (`pending`, `processing`, `done`, `failed`), attempts, game count, processed at.
2. **Processing:** one month at a time, server-wide (the Lichess database site asks for one request at a time). Streamed: download, decompress and parse headers in one pass; never hold the file in memory or on disk. A month is written in one transaction and marked `done`; a crash leaves it `processing` and a stale `processing` (over 15 minutes) is retried. Three failures mark it `failed`; a later search retries a `failed` month once a day.
3. **Where it runs:** inside the web server process, started by a search that needs a month that is not `done`; a database row lock decides which process works, so a restart or a second request never processes the same month twice.
4. **Which months:** the 12 newest entries of `list.txt` at search time (fetched at most once an hour).
5. **The search page** (`/fide`, linked from the home page): a FIDE ID field (digits only, 1 to 9 digits; refusal values for anything else). The result shows the player's name, federation and standard rating from the Lichess FIDE endpoint (cached a day; if it fails the search still runs, without the header), then the games newest first: date, event, opponent (name and FIDE ID when present), colour, result from the searched player's side, ECO and opening, and a "Open on Lichess" link (the game URL). While months are processing the page shows "N of 12 months ready" and refreshes until done; the games of ready months show at once. A month whose processing failed within the last 24 hours shows as "unavailable, retried tomorrow"; the page counts it as neither ready nor waiting and stops refreshing once no month is still waiting or processing. Each month's display comes from the domain's next action for it, never from its stored state.
6. **Limits:** a user may start at most 10 searches a minute (the existing rate-limit table). A search answers only from the index; it never downloads synchronously.
7. **Privacy:** the index holds public broadcast data only (names, FIDE IDs, game links). Searches are not logged with the searched ID. The data export (R-40) does not include it: it is not the user's data.

## Design

- **integrations** (new package `packages/integrations`, `@mychess/integrations`): `broadcastMonths(fetch, signal)` reads `list.txt` into months (taken from the file names only); `openBroadcastDump(fetch, month, signal)` streams and decompresses one month under size caps; `broadcastGames(text)` turns the decompressed PGN into game header records (games without any FIDE ID skipped); `lichessFidePlayer(fetch, id, signal)` parses the FIDE endpoint. Pure functions over injected `fetch`, streams and an AbortSignal. The package checks only the formats the security requirements name; every record is parsed again with the domain's `broadcastGameSchema` where the db writes it, which stays the single source of truth. Tests use synthetic fixtures; an opt-in contract test (`MYCHESS_CONTRACT=1`) checks the live formats and never runs in the gate.
- **domain** (`packages/domain`): `fideId(raw)` parse with refusal reasons; `searchMonths(list, now)` (the 12 newest); `gameForPlayer(game, fideId)` (colour, opponent, result from the player's side); the month processing state machine (`pending -> processing -> done | failed`, stale and retry rules) as pure functions.
- **db** (`packages/db`): tables `broadcast_months` and `broadcast_games` (index on white and black FIDE ID); migration; repositories: claim a month (row lock), write a month's games and mark done in one transaction, mark failed, games for a FIDE ID across months, month states.
- **web** (`apps/web`): page `/fide` with the form and result list; two POST server actions instead of a route (security requirements): start (authenticated, rate limited, returns a signed search token bound to the account, the FIDE ID and the months, valid one hour) and poll (presents the token, never counted, cannot look up another ID); the background runner that processes needed months one at a time; home page link.

## Testing

TDD per layer. integrations: list parsing, header stream parsing incl. a game without FIDE IDs and a malformed header; domain: FIDE ID refusals, month selection, colour/result mapping, state machine; db: claim is exclusive, a month writes atomically, search returns across months newest first; web: form refusals, progress view, list rendering, Lichess link. A feature test runs the runner against a local fixture server, never the real site. E2E: one journey with the runner pointed at a fixture file.

## Done means

A signed-in user enters a FIDE ID on `/fide`, sees months become ready, then the player's broadcast games from the last 12 months with Lichess links; a second search for any ID over the same months is instant; the gate is green and production deploys.
