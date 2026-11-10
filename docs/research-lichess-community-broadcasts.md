# Lichess community broadcasts - can mychess find them legitimately?

Researched 2026-11-10. Sources: Lichess OpenAPI spec (`lichess-org/api`, `doc/specs/lichess-api.yaml` and `doc/specs/tags/broadcasts/*`, `tags/fide/*`, `schemas/*`), lila source on `master` (`conf/routes`, `app/controllers/RelayTour.scala`, `app/controllers/Fide.scala`, `modules/relay/src/main/{RelayPager,RelayTourRepo,RelayListing,RelayHome,RelayCalendar,RelayPlayerTour}.scala`), lila PR #21283, database.lichess.org, lichess.org/terms-of-service. Live checks: 6 unauthenticated GETs, one at a time, User-Agent `MyChess research (+https://mychess.lt)`. No HTML page was fetched apart from the ToS and database.lichess.org (neither blocks bots); `lichess.org/fide/*` was not touched; nothing else about FIDE ID 12859168 was fetched.

Test case: Vilnius Open 2026 = tournament `8PbrZM5O`, round 8 `GzyWUqHk`.

## Key fact: "official" = `tier` set

`RelayTourRepo.selectors`:

```scala
val official = bdoc("tier".exists(true))
val nonOfficial = bdoc("tier".exists(false))
val officialPublic = official ++ vis.public
```

Vilnius Open 2026 has no tier (community): `GET /api/broadcast/vilnius-open-2026/round-8/GzyWUqHk` returned `tour.tier = None`, `communityOwner = {name: "paulauskas"}`. (Vilnius Open 2025 had `tier: 3`, so it was official and is in the dumps.)

## (1) Listing community broadcasts

| Endpoint | Selector in lila | Community? | Vilnius Open 2026 found? |
| --- | --- | --- | --- |
| `GET /api/broadcast?nb=..&live=..` (ndjson, max 100) | `officialTourStream` | No ("Get official broadcasts") | No |
| `GET /api/broadcast/top?page=1..5` | `RelayHome`: `listing.active` (`officialActive`) + `pager.inactive` (`officialInactive`) | No | No |
| `GET /api/broadcast/search?q=&page=1..20` | `textSearch ++ selectors.officialPublic` | No ("Search across recent official broadcasts") | No - live query `q=Vilnius` returned 8 hits, all `tier: 3` (Vilnius Open 2025 A/B, LŠL 2026, ...), not 2026 |
| `GET /api/broadcast/calendar/{year}/{month}` (in routes, not in spec) | `selectors.officialPublic ++ inMonth` | No | No |
| `GET /broadcast/non-official` (pager) | `nonOfficialExpensiveNoIndexHitForAdminsOnly` | Yes, but `Secure(_.StudyAdmin)` | Not usable |
| `GET /api/broadcast/by/{username}?page=` (24 per page, max page 20) | `selectors.ownerId(owner) ++ vis.public` - no tier filter | **Yes** (spec text says "official", source does not filter by tier) | **Yes** - `by/paulauskas` returned 4 tours: `8PbrZM5O` Vilnius Open 2026 (tier None), `oBePyBLV` Vilnius Invitational 2026 - IM (tier None), and the two 2025 official ones |
| FIDE player page tour list (`RelayPlayerTour.playerTours`) | `pager.byIds(ids)` = `inIds(ids) ++ selectors.officialPublic` | No | n/a (and HTML is off limits anyway) |

Conclusion: **no public endpoint enumerates community broadcasts by date or globally.** The only enumeration is per owner account (`/api/broadcast/by/{username}`), sorted by `createdAt` desc, public only for anonymous/other-user callers. A tour with no `round` key in that response has all rounds finished (pipeline `roundPipelineFirstUnfinished`).

Note on the owner ruling: `{username}` here is the broadcast **organiser's** Lichess account, not the player's. It is still an online nickname, so whether a curated list of organiser accounts is allowed is an owner decision, not ours.

## (2) Players and PGN of a known tournament

- `GET /broadcast/{tourId}/players` (spec: `security: []`, JSON array of `BroadcastPlayerEntry`: `name, fideId, fed, rating, score, played, rank, ...`). Live: 200, 42 players, all 42 with `fideId`; `{name: "Konovalovas, Paulius", fideId: 12859168, fed: "LTU", played: 2}` present.
- `GET /api/broadcast/{tourId}.pgn?clocks=false&comments=false` - "Download all games of all rounds". Live: 200, `application/x-chess-pgn`, 91.8 kB, 79 games, headers include `WhiteFideId`/`BlackFideId`, `BroadcastName`, `BroadcastURL`, `GameURL`; 2 games carry `FideId "12859168"`. Filename `lichess_broadcast_vilnius-open-2026_8PbrZM5O_2026.07.16.pgn`, `cache-control: public, max-age=600`.
- `GET /api/broadcast/{slug}/{roundSlug}/{roundId}` (round JSON) gives `tour.id`, `tier`, `dates`, `communityOwner`, `info` (format, tc, `fideTC`, location, chess-results standings URL). Useful to resolve a pasted broadcast link to a tour id.

So once a tournament id is known, one PGN request gives every game with FIDE IDs. Community and official behave the same here.

## (3) Broadcasts of a FIDE ID without the HTML page

- `GET /api/fide/player/{id}` returns `FIDEPlayer` = `id, name, title, federation, year, inactive, standard, rapid, blitz, gender, photo` (+ follow). No tournament list. `/api/fide/player/{id}/ratings` is rating history only. Not fetched live for 12859168 (instruction); answer is from schema and `Fide.apiShow`.
- `Fide.show` (the HTML page) is the only consumer of `relay.playerTour.playerTours`; there is no JSON variant in routes, and it is rate limited (`limit.enumeration.fidePlayer`). Besides, it uses `officialPublic`, so **even lichess.org/fide/<id> does not list community broadcasts.**

Conclusion: no legitimate way exists, and the HTML route would not help anyway.

## (4) Licence, terms, rate limits

- database.lichess.org: "Database exports are released under the Creative Commons CC0 license" (general) but for broadcasts: "games in PGN format, from the official Lichess broadcasts. Broadcast games are released under the Creative Commons Attribution-ShareAlike 4.0 license."
- **No source states a licence for community broadcast games fetched through the API.** ToS: users "retain your rights in any content you submit" and grant Lichess a sub-licensable licence; services may be used "for your own personal or commercial use, such as in your own applications", subject to "the relevant licenses" and "reasonable caps". Game moves are generally considered facts, but the safe position is to treat community games like the dumps (attribute "Lichess broadcast, CC BY-SA 4.0" + `GameURL`) and get the owner's ruling. Option: ask Lichess (contact@lichess.org / Discord) to confirm.
- Rate limits (spec "Rate limiting"): "Only make one request at a time. ... 429 ... waiting one minute before retrying".
- Broadcast tag (spec): "All tournament endpoint requests must be authenticated with (at least) a `study:read` token. Unauthenticated endpoints are heavily rate-limited and might stop functioning." PR #21283 (merged 2026-08-18):
  - JSON endpoints: authenticated 120 req/min; anonymous 10 req/min "(soon to be zero)".
  - PGN download: "Use only on finished events, never poll for updates"; authenticated 3 concurrent downloads, 30 games/s; anonymous 1 concurrent, 10 games/s.
  - Streams: authenticated 8 concurrent; anonymous 1 "(soon to be zero)".
- So mychess needs a personal access token with only `study:read` (server env var, never shipped to clients), from a Lichess account owned by mychess.

## Discovery options (none is a global listing)

A. **Curated organiser accounts** - nightly `GET /api/broadcast/by/{organiser}` for a list of Lithuanian organiser accounts (e.g. `paulauskas`). Finds Vilnius Open 2026. Needs owner ruling (uses an organiser nickname; list must be maintained).
B. **Link submission** - a coach/player/admin pastes a lichess broadcast URL; server resolves it via round JSON and fetches the tour PGN once. No nicknames, no listing. Finds Vilnius Open 2026 if someone pastes it.
C. **Ask for official tier** - Vilnius Open 2025 was tier 3. Organisers (or the LŠF) can ask the Lichess broadcast team to mark events official; they then flow into the monthly dump we already index. Zero code.
D. **Ask Lichess** for a community listing or community dump. Not available today.

## Recommended design for the mychess server

1. Keep the monthly official dump index (unchanged).
2. Add a `study:read` token (env var, e.g. `LICHESS_BROADCAST_TOKEN`), sent as `Authorization: Bearer` on every broadcast call; one request at a time, ~1 s spacing, on 429 back off 60 s+ and stop the run.
3. Discovery: B (link submission) by default, plus A if the owner rules organiser accounts are acceptable (`lichess_broadcast_source` table: organiser account, added by admin). Recommend C to organisers in parallel.
4. Nightly job:
   - For each curated organiser: `GET /api/broadcast/by/{organiser}?page=1` (24 newest tours; stop paging when `createdAt` is older than what we have).
   - For each submitted link: one round-JSON call to get `tour.id`.
   - Skip tours that are official (`tier` present: already in the dump), private/unlisted (not returned anyway), or not finished (a `round` key is present in the by-owner result, or `dates[1]` > now).
   - For each new finished community tour, once: `GET /api/broadcast/{id}.pgn?clocks=false&comments=false`; parse with zod/PGN parser, index games by `WhiteFideId`/`BlackFideId`; store `BroadcastURL`/`GameURL` for attribution; mark tour as imported (never re-download; optional one re-fetch after 7 days to catch late corrections).
   - `/broadcast/{id}/players` is not needed (PGN already carries FIDE IDs).
5. Estimated volume: with ~20 organiser accounts, ~20 listing calls + ~0-3 PGN downloads per night (a few Lithuanian community events per month, each ~100 kB / ~80-300 games) - well under 120 req/min and a negligible share of the 30 games/s download limit. Run takes under a minute.

## Evidence snippets

- `api-broadcasts-official.yaml`: "Returns active (a round is scheduled or ongoing) official broadcasts sorted by tier."
- `api-broadcasts-top.yaml`: "The same data, in the same order, as can be seen on https://lichess.org/broadcast." (page max 20 in spec, `Max(5)` in controller)
- `api-broadcasts-search.yaml`: "Search across recent official broadcasts."
- `RelayPager.search`: `val textSelector = textSearch(...) ++ nameFilter ++ selectors.officialPublic`
- `RelayPager.byOwner`: `Match(selectors.ownerId(owner.id) ++ isMe.not.so(selectors.vis.public))` - no tier filter.
- `RelayPager.byIds` (used by FIDE page): `inIds(ids) ++ selectors.officialPublic`
- `RelayCalendar`: `Match(selectors.officialPublic ++ selectors.inMonth(at))`
- `RelayTour.pager`: `case "non-official" => nonOfficial(page)` guarded by `Secure(_.StudyAdmin)`.
