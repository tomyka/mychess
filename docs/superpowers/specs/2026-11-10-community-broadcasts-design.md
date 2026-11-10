# Community broadcasts and the current month in Opponent's games

Issue #349. Research: `docs/research-lichess-community-broadcasts.md`, `docs/research-lt-broadcast-organisers.md`.

## The rulings applied

- R-171, R-191: any FIDE ID; players matched only by FIDE ID; never a player's own online account.
- R-196, R-200: community broadcasts found through the approved organiser accounts `vakarinis`, `kesnor7`, `paulauskas`; the owner approves additions.
- R-197: any signed-in user may add a Lichess broadcast by pasting its link; the tournament is fetched once.
- R-198: community games carry the same Lichess CC BY-SA 4.0 credit and each game's link.
- R-199: Lichess API calls use the owner's `study:read` token from the VM secrets.
- R-183 to R-190, R-195: the 12-month window, grouping, nightly upkeep and the existing month index stay as they are.

## Findings this rests on

- The monthly dumps hold official broadcasts only and lag about six weeks.
- No endpoint lists community broadcasts globally. `GET /api/broadcast/by/{account}` lists an account's tournaments, community and official (official ones have `tier`), 24 a page, newest first. `GET /api/broadcast/{tourId}` gives a tournament's rounds and dates; `GET /api/broadcast/{tourSlug}/{roundSlug}/{roundId}` resolves a pasted round link. `GET /api/broadcast/{tourId}.pgn?clocks=false&comments=false` gives every game with `WhiteFideId`/`BlackFideId`, `GameURL`, `BroadcastName`.
- Limits: one request at a time; with a token 120 JSON requests a minute and PGN 30 games a second; on a 429 wait a minute. PGN downloads only for finished events.
- The same event can exist as a community and an official tournament (different game links).

## Lead decisions

1. **A tournament index next to the month index.** A tournament (Lichess tour id) is fetched once, when finished, and its games with a FIDE ID join the same game store as the months; each game keeps its source (month dump or tournament). A game link already stored is not stored again.
2. **Which tournaments are fetched:** (a) every finished community tournament of an approved organiser whose last round is within the 12-month window; (b) every finished official tournament of those organisers newer than the newest dump month (closes the dump lag for Lithuanian events); (c) any tournament a user pasted, official or community, finished, within the window. A tournament still running is fetched the night after it finishes.
3. **Nightly:** the existing nightly job (R-195) also lists each approved organiser's tournaments (page 1, more pages until older than the window) and queues new finished ones; one request at a time about a second apart; stops for the night on a second 429.
4. **Pasting a link:** a field "Add a Lichess broadcast" on Opponent's games. Only `https://lichess.org/broadcast/...` links; the server resolves the tournament, refuses with a value when it is not finished, outside the window or unknown, and queues it otherwise; at most 10 pasted links per account a day (rate limit). The page says when it has been added.
5. **Showing games:** a search shows tournament games next to month games, grouped as today. When a community and an official copy of the same game exist (same date, same two FIDE IDs, same result), the list shows one (prefer the official one).
6. **Token:** `LICHESS_TOKEN` in the server env, sent as `Authorization: Bearer` on every Lichess API call; refused in the browser; the env schema requires it in production for this feature to run; owner sets it on the VM with `set-secret.sh`.
7. **Organiser list** lives in the domain as a constant with the ruling reference; changing it is a reviewed code change.

## Design

- **integrations:** clients for `by/{account}` (paged), tour JSON, round-link resolution and tour PGN (reuse the header parser and its limits), all with the token and `redirect: 'error'`.
- **domain:** the approved organisers; which tournaments qualify (finished, window, official versus community, newer than the newest dump month); link parsing with refusal values; the de-duplication rule; the paste rate limit.
- **db:** a `broadcast_tours` table (tour id, name, organiser or pasted, official flag, last round date, state as for months, game count); games carry their source; migration; repositories to queue, claim, write and search.
- **web:** the nightly job extended; the paste field and its server action; the search merging and de-duplicating; the runner processing tournaments as it processes months (one download at a time overall).
- **infra:** `LICHESS_TOKEN` in `production-env.sh`, `set-secret.sh` and the env docs.

## Done means

A search for 12859168 shows Paulius's Vilnius Open 2026 games (community, `paulauskas`) and his official games; a pasted Lichess broadcast link adds that tournament's games; the gate passes and production deploys.
