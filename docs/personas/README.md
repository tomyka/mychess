# Personas

Four test personas for mychess v2, per owner rulings Q7 and Q18 in [#226](https://github.com/tomyka/mychess/issues/226). Parent epic: [#225](https://github.com/tomyka/mychess/issues/225).

Tiers are QA personas plus soft product defaults (suggested repertoire depth, starter repertoire). They never gate features (Q7).

| Persona | Doc | Issue | Rating | UI language | Main devices | Repertoire depth | Tester agent |
|---|---|---|---|---|---|---|---|
| Rimantas Vaitkus, coach (FM, FIDE Trainer) | [coach.md](coach.md) | [#245](https://github.com/tomyka/mychess/issues/245) | FIDE 2205 | LT | Windows laptop, Android phone | Assigns tier-fitting repertoires; group assignment 10-12 moves | [persona-coach](../../.claude/agents/persona-coach.md) |
| Rokas Petrauskas, player 0-1400 | [u1400.md](u1400.md) | [#246](https://github.com/tomyka/mychess/issues/246) | Lichess rapid 1350, FIDE unrated | LT | Android phone (PWA) | Shallow, about 8 moves | [persona-u1400](../../.claude/agents/persona-u1400.md) |
| Gabija Navickaitė, player 1400-2000 | [1400-2000.md](1400-2000.md) | [#247](https://github.com/tomyka/mychess/issues/247) | FIDE 1720 | LT, switches to EN | iPhone, MacBook | Main lines, about 12 moves, a few branches | [persona-1400-2000](../../.claude/agents/persona-1400-2000.md) |
| Dovydas Jankauskas, player 2000+ (also coaches) | [2000plus.md](2000plus.md) | [#248](https://github.com/tomyka/mychess/issues/248) | FIDE 2185 | EN | Desktop, iPad | Deep, 20+ moves, many branches | [persona-2000plus](../../.claude/agents/persona-2000plus.md) |

All three players are in the coach's group "Šeštadienio grupė" and share the group assignment "Karo-Kan gynyba: pagrindai".

## What each persona exercises

| Ruling | Coach | 0-1400 | 1400-2000 | 2000+ |
|---|---|---|---|---|
| Q25 one account, coach is a capability | Coach who also trains | | | Player who also coaches two students |
| Q2 several coaches | | | Second coach (no assignments) | |
| Q3/Q28 live assignment, fork, personal notes | Owns assignments | Notes only, blocked edit | Forks the Queen's Gambit | Forks the Najdorf, shares it back |
| Q26 privacy | Must not see private repertoires | Private London | Shared Taimanov | Private Catalan and Nimzo |
| Q27 transpositions, several repertoires per side | | Italian transposition, two Black answers to 1.e4 | Taimanov move-order transposition | |
| Q29 coach edits reconcile | Edits Italian, Slav | Receives Italian update | Receives Slav branch | Fork is unaffected |
| Q31 group assignment inheritance | Group Caro-Kann, remove/re-add | Inherits | Inherits | Inherits, does not want it |
| Q30 game deviation (M3) | Group deviation view | Own mistake 4.d4 | Own mistake 9...Bd6 | Own mistake at move 17 |
| Performance and import fidelity | | | PGN round trip | 2,000-position repertoire, NAGs |

## How personas are used

1. **Seeded staging accounts.** Each doc's "Seed data" section is the spec for a staging seed (accounts `persona-<id>@mychess.test`, repertoires as PGN, links, groups, assignments, training history, goals, messages, games). The seed must be idempotent and must never run against production.
2. **E2E fixtures.** The same seed definitions back the E2E fixtures. Every journey ID (for example `U1-M1-3`, `C-M2-1`) maps to at least one happy-path E2E test; the test name should include the journey ID.
3. **Persona tester agents.** The lead runs the four agents in `.claude/agents/persona-*.md` against staging at the end of each milestone (M1, M2, M3). Each agent walks its persona's journeys for that milestone in character and explores around them, then reports findings to the lead in a fixed format. The agents never edit code and never file issues; the lead triages and files them (labels `persona/<id>` plus `area/*`).

## Conventions

- Repertoire lines live in ```` ```pgn ```` fences, one line per row, with a `{label}` prefix. Every line was checked for legality with chess.js (1.0.0) on 2026-10-16; keep them legal when editing (any SAN parser that replays each row from the start position will do).
- Late moves in the 2000+ lines (after about move 15) are representative, not engine-verified theory; chess-dev reviews them before any of them become starter content.
- Lithuanian opening titles here are working names; the product uses the šachmatai.lt taxonomy (Q1).
- External identities (FIDE, Lichess, Chess.com, chess-results.com) are placeholders served by staging fixtures. No real person's account or rating data is used.

## Open dependencies

- Staging URL and a test-only sign-in path for `@mychess.test` accounts (magic links on staging must be capturable without a real inbox). Until these exist, the tester agents cannot run.
- Staging fixture adapters for FIDE (incl. the LTU ranking), Lichess, Chess.com and chess-results.com (M3). LSF has no national rating; the Lithuania ranking comes from the FIDE list (#232).
- Spec decisions flagged as observations in the docs: two repertoires answering the same position (Rokas), hiding an unwanted group assignment (Dovydas), skipping the learn pass for known material (Dovydas), trusted-coach review of starter repertoires (coach).
