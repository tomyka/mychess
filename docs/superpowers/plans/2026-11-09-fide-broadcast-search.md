# Plan: FIDE ID broadcast game search

Spec: `docs/superpowers/specs/2026-11-09-fide-broadcast-search-design.md`. Issue #316.

Each task: developer (test first) -> qa -> architect -> security-reviewer if marked -> lead runs the gate and commits.

0. **Scaffold `packages/integrations`** - owner (gate configs are protected): `package.json` (`@mychess/integrations`, deps `@mychess/chess`, `zod`), `tsconfig.json`, `tsconfig.strict.json`, `vitest.config.ts` copied from `packages/chess`, a `src/index.ts`, and a `knip.json` workspace entry.
1. **Integrations clients** - integrations-dev: month list, header stream parser, FIDE player endpoint; fixtures synthetic.
2. **Domain rules** - backend-dev: `fideId`, `searchMonths`, `gameForPlayer`, month state machine.
3. **Schema and repositories** - backend-dev: `broadcast_months`, `broadcast_games`, migration, claim/write/search repositories. - SECURITY (new public-data store).
4. **Runner and route** - web-dev: background month processing in the server; two POST server actions, start (rate limited) and poll (search token, 1 h); no route handler. - SECURITY (outbound fetch, resource use).
5. **Page** - web-dev: `/fide` form, progress, list, Lichess links, home link. - UX
6. **E2E journey and docs** - qa: journey with a fixture month; operations.md note on the index and how to reset a month.

## Security requirements (security-reviewer, 2026-11-09)

Task 1 (integrations):
- Outbound requests only to URLs built from constants: `https://database.lichess.org/broadcast/list.txt`, `.../lichess_db_broadcast_<YYYY-MM>.pgn.zst`, `https://lichess.org/api/fide/player/<id>`; the month and ID are parsed first; never fetch a URL read from `list.txt`; `redirect: 'error'`.
- Size limits, counted while streaming: `list.txt` 64 KB; compressed dump about 100 MB; decompressed about 1 GB; about 200k games a month; FIDE response 64 KB. Exceeding one aborts with an error.
- Header parsing: line length and header count capped; move text skipped, never collected; FIDE IDs through the domain rule, invalid ones become null; Date a real date or null; Result one of four or the game is skipped; GameURL must match the domain's Lichess pattern or the game is skipped; names, event, opening trimmed, capped at 200 characters, control characters stripped.
- A pull-based async generator, so the chunked inserts give backpressure. The FIDE response is zod-parsed. Fixtures are synthetic.

Task 4 (runner and route):
- One AbortSignal over fetch, decompression and write, under the 15-minute stale window (10 minutes); an idle timeout of about 60 s; on abort or error call `failMonth` and destroy the streams.
- At most one month in progress per process (single-flight), besides the row lock.
- The rate limit runs after authentication and before any database or outbound work; only a search start counts; progress polling goes through a short-lived server-side search token or its own higher limit.
- The searched ID never reaches logs or the Referer: POST with the ID in the body (or no path logging for the route), no console line with the ID, `Referrer-Policy: no-referrer` on `/fide`.
- The route never downloads; it reads `monthStatuses` and `gamesForFideId` for ready months and starts the runner without waiting. `list.txt` cached an hour, the FIDE player a day, in memory only.
- A refused claim (another process holds the month) is "waiting", never shown as failed.

## Notes for task 4 (architect, 2026-11-09)

- The route derives ready / waiting / unavailable per month from the domain's next action at `now`, never from the stored state (a stale `processing` row is only re-judged there). "N of 12 ready" counts the months whose action is use.
- A refused claim covers three cases (locked or processing, done, failed within the window): the runner skips the month and leaves the display to the rule above.
- The month write takes no AbortSignal: the integrations generator must honour the runner's signal; on a claim-lost refusal the write returns without reading the stream, so the runner destroys the download itself. Do not pass the write options (they exist for tests): the db's 120 s idle backstop sits above the runner's 60 s idle limit.
- After the write rejects (stream error or idle kill), call the fail repository on a fresh connection; never after a claim-lost refusal.
- Reset a month for operations by setting it back to pending, never by deleting its row (deleting cascades games a later month also listed).
