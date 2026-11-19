# Opponent's games (`/fide`)

Written after the fact (#347), for the screen built in #316, grouped in
#348 and compacted in #347. A signed-in account (R-186) enters a FIDE ID
and sees that player's Lichess broadcast games of the last 12 months, to
prepare for them (R-171). Vocabulary from `docs/CONTEXT.md`, tokens from
`apps/web/src/app/tokens.css` (see `README.md`). English only for now
(R-180); every label was written with the Lithuanian length in mind.

## Phone, 390px

```
+--------------------------------------+
| Home                                 |  back link, 44px target
| Opponent's games                     |  h1, text-2xl
| Enter a player's FIDE ID to list ... |  intro, fg-muted
|                                      |
| FIDE ID                              |  label
| [______________________________]     |  numeric keyboard, never in the URL
| Digits only, as on the player's ...  |  hint, text-sm
| [            Search             ]    |  primary, full width on a phone
| (refusal line, error tone)           |  status line, empty until refused
|                                      |
| Jonaitis, Rokas                      |  h2: name, or "Games of FIDE ID n"
| FIDE ID 13400002 · LTU · 2312        |  fg-muted
| 7 of 12 months ready                 |  the only line announced as it changes
| [==============---------]            |  bar, accent on border track
| 1 month unavailable, retried ...     |  text-sm, only when one is
| The other months are being ...       |  while a month is waiting
|                                      |
| (o) As White                         |  h3 with a white piece swatch
| +----------------------------------+ |
| | Caro-Kann Defense             v  | |  summary: family + chevron
| | 3 games · +1 =0 -1 · 1 unfinished| |  numbers in success / fg / error
| +----------------------------------+ |
| | Oct 14, 2026 · Synthetic Open    | |  text-sm, fg-muted
| | vs Testas, Jonas (FIDE 9000) [Won]| |  opponent + result badge
| | B12 Advance Variation  Open on L.| |  variation + link, 44px target
| +----------------------------------+ |
| (●) As Black                         |
| ...                                  |
| Games from Lichess broadcasts · CC.. |  credit, text-sm, two links
+--------------------------------------+
```

On a wide screen the Search button moves up beside the field; the rest is
the same column, at most `max-w-2xl`.

## Rules

- **Grouping is the domain's** (`groupByColourAndFamily`, R-189, R-190):
  As White, then As Black (a colour with no game left out); one disclosure
  per opening family, most games first, ties by name, "Unknown opening"
  last; a group's games newest first.
- **The first two groups of each colour start open**, the rest closed.
  A group keeps its state once shown: games that arrive while months are
  prepared reorder the groups, but none opens or closes by itself, and a
  group the person opened or closed stays that way
  (`use-family-disclosures.ts`).
- **No colour on a game.** The section says the colour, so a game shows only
  its result badge (#347 F1).
- **The opening within its family.** The group names the family, so a game
  shows the ECO code and the variation ("B22 Alapin Variation"), or the
  whole name when it is the family alone ("C42 Russian Game") (#347 F2).
- **Score at a glance.** The summary's second line is the count and
  `+wins =draws −losses` in `success`, `fg` (no neutral state token exists) and `error`; it is hidden from a
  screen reader, which hears the words ("3 games · 1 won, 0 drawn, 1 lost")
  instead (#347 F5).
- **Result badges.** Won `success-subtle`/`success`, Lost
  `error-subtle`/`error`; Drew and Unfinished are outlined in
  `border-strong` (Unfinished dashed), because a `sunken` fill vanished on
  the dark card (#347).
- **Only Lichess game addresses become links** (`LICHESS_GAME_URL`); every
  external link opens a new tab, says so to a screen reader, and has
  `rel="noopener noreferrer"`. The page itself is served with
  `Referrer-Policy: no-referrer`.

## States

| State | What shows |
| --- | --- |
| Idle | The form only. |
| Refused | The refusal in the status line; the field `aria-invalid` and pointed at it. Hidden again while the next search runs. |
| Searching | Button reads "Searching…", disabled; the form `aria-busy`. |
| Months waiting, none ready | Progress only. |
| Months waiting, some ready, no games | "No games of this player in the N ready months so far." |
| All done, no games | "No broadcast games of this player in these months." |
| No month could be searched | "No month could be searched right now. Try again later." |
| Cut at the index's cap | "Only the newest N games are shown." above the list. |
| Search expired | Polling stops; "This search has expired..." is announced. |

## Keyboard and screen readers

- The page polls every 5 s while a month is waiting. Only the "N of 12
  months ready" line is a live region, so a poll that changes nothing else
  says nothing; the expiry has its own region, present from the start.
- A summary is one tab stop; its focus ring follows the card's rounded
  corners. Hovering it darkens the card's border to `border-strong` (3:1); a
  `sunken` fill would vanish on the dark card.
- A result badge is plain text read after the opponent ("vs Testas, Jonas
  (FIDE 90000002) Won").

## Open

- Lithuanian wording of the summary when R-180 is lifted (F6).
- A VoiceOver pass over the summary's name (F7).
- Family names as headings if lists grow long (F8).
- A per-account poll limit (security L3 of #316, about 120 a minute), only
  if abuse appears: each poll is cheap and capped today.
