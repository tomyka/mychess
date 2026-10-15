# Persona: Rimantas Vaitkus (Coach)

Issue: [tomyka/mychess#245](https://github.com/tomyka/mychess/issues/245). Rulings: [#226](https://github.com/tomyka/mychess/issues/226) (Q2, Q5, Q7, Q18, Q25-Q34).

## Profile

| Field | Value |
|---|---|
| Name | Rimantas Vaitkus |
| Age | 52 |
| Location | Kaunas; runs a Saturday group at a local club and coaches some players online |
| Titles | FIDE Master (FM), FIDE Trainer |
| Ratings | FIDE 2205 (peak 2290). Lithuania rank from the FIDE-LTU list (#232). Lichess blitz 2310 (plays rarely) |
| Language | Lithuanian; expects correct Lithuanian chess terminology and opening names from the šachmatai.lt taxonomy. Uses EN only when reading foreign material |
| Devices | Windows laptop (Chrome) for preparing and assigning material; Android phone for checking progress and replying to messages between lessons |
| Students | Group "Šeštadienio grupė": [Rokas Petrauskas](u1400.md) (0-1400), [Gabija Navickaitė](1400-2000.md) (1400-2000), [Dovydas Jankauskas](2000plus.md) (2000+). About 15 more students outside the seed set in real life |

Rimantas has coached for twenty years. Until now his workflow was: PGN files emailed to students, a spreadsheet of who did what, and asking "did you look at the Slav?" at the start of every lesson. He has tried Chessbook and ChessReps but neither is in Lithuanian and neither shows him what his students actually did. He is comfortable with a laptop and PGN but not a power user; he will not read help pages.

## Goals

- Give each student a repertoire that fits their level, from one place, without emailing files.
- See before Saturday who did their homework, which lines they keep getting wrong, and where their real games left the repertoire.
- Fix or extend a line once and have every student who has it get the update.
- Give one group-wide assignment (the Caro-Kann basics) and have new group members get it automatically.
- Spend lesson time on understanding, not on checking memorisation.

## Frustrations

- Per-student copies of the same PGN drifting apart after he corrects one move.
- Students who say they trained but cannot show it.
- English-only interfaces that his weaker students struggle with.
- Tools that show raw data (hundreds of cards) instead of "who needs attention".
- Losing access confusion: he wants to know exactly what he can see and what is private.

## Training habits (as a coach)

- Prepares material on Thursday evenings on the laptop: imports PGN, edits lines on the board, adds per-move notes in Lithuanian.
- Checks the dashboard on the phone on Friday evening and Saturday morning before the group session.
- Replies to questions in short bursts during the week; prefers one daily email digest.
- Still trains his own repertoire occasionally (coaches are players too, Q25); not a focus of these tests.

## What success means

- One dashboard view answers "who did the homework, who is struggling, on which line" for the whole group in under a minute.
- Correcting a move in an assigned repertoire updates every student with progress handled sensibly (Q29).
- New group members receive group assignments without him doing anything (Q31).
- From M3 on, he sees each student's real games against the repertoire without asking for PGNs.

## Repertoire library (what he assigns)

He owns and assigns tier-fitting repertoires; full lines are in each player's persona doc:

| Repertoire (LT title) | Side | Assigned to | How |
|---|---|---|---|
| "Itališkoji partija" (Italian Game) | White | Rokas | Individual, deadline 2026-11-30 |
| "1...e5" (open games) | Black | Rokas | Individual |
| "Atmestas valdovės gambitas" (QGD) | Black | Rokas | Individual |
| "Valdovės gambitas" (Queen's Gambit) | White | Gabija | Individual, deadline 2026-12-15 |
| "Slavų gynyba" (Slav Defence) | Black | Gabija | Individual, deadline 2026-11-30 |
| "Naidorfo variantas" (Najdorf: English Attack and 6.Bg5 chapters) | Black | Dovydas | Individual; Dovydas has forked it |
| "Karo-Kan gynyba: pagrindai" (Caro-Kann basics) | Black | Group "Šeštadienio grupė" | Group assignment, deadline 2026-12-20 |

Opening titles are working names; the product's canonical LT names come from the šachmatai.lt taxonomy (Q1).

### Group assignment: "Karo-Kan gynyba: pagrindai"

Deliberately shallow-to-medium (10-12 moves) so it fits all three tiers. It is the shared homework of the group and the main fixture for group-assignment inheritance (Q31).

```pgn
{Advance, Short variation} 1. e4 c6 2. d4 d5 3. e5 Bf5 4. Nf3 e6 5. Be2 c5 6. Be3 Nd7 7. O-O Ne7 8. c4 dxc4 9. Na3 Nd5 10. Nxc4 Nxe3 11. Nxe3 Be4
{Classical} 1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7 8. h5 Bh7 9. Bd3 Bxd3 10. Qxd3 e6
{Exchange} 1. e4 c6 2. d4 d5 3. exd5 cxd5 4. Bd3 Nc6 5. c3 Nf6 6. Bf4 Bg4 7. Qb3 Qd7 8. Nd2 e6 9. Ngf3 Bd6 10. Bxd6 Qxd6
{Panov} 1. e4 c6 2. d4 d5 3. exd5 cxd5 4. c4 Nf6 5. Nc3 e6 6. Nf3 Be7 7. cxd5 Nxd5 8. Bd3 Nc6 9. O-O O-O 10. Re1 Bf6
{Two Knights} 1. e4 c6 2. Nc3 d5 3. Nf3 Bg4 4. h3 Bxf3 5. Qxf3 e6 6. d4 Nf6 7. Bd3 dxe4 8. Nxe4 Qxd4 9. c3 Qd8 10. O-O Nbd7
```

## Journeys

Laptop (1440x900) for preparation journeys, phone (390x844) for dashboard and messaging journeys.

### M1 Core loop

| ID | Journey | Expected outcome |
|---|---|---|
| C-M1-1 | Sign up (magic link), switch on the coach capability, create the group "Šeštadienio grupė" | One account; coach area appears alongside his player area (Q25); group created with an invite link |
| C-M1-2 | Share the group invite link with the three players; each accepts | Each player appears in the group only after accepting; until then he sees nothing of theirs (Q2, Q34) |
| C-M1-3 | Import "Karo-Kan gynyba: pagrindai" from PGN and assign it to the group | All three members receive it; a fourth account that joins later also receives it, with its deadline = later of the group date and the join date (Q31) |
| C-M1-4 | Build "Itališkoji partija" with the board builder, add Lithuanian per-move notes, assign it individually to Rokas | Assignment appears for Rokas only; notes show in Lithuanian during Rokas's review |
| C-M1-5 | Open the basic progress view for the group | Per player and per line: learned / in review / due / not started; Rokas's private London repertoire is not listed (Q26) |
| C-M1-6 | Remove Rokas from the group (then re-add) | Group assignment disappears from Rokas's list but his individual assignments stay; re-adding restores it with progress intact (Q31) |

### M2 Coaching

| ID | Journey | Expected outcome |
|---|---|---|
| C-M2-1 | Correct 8.Bb3 to 8.a4 in "Itališkoji partija" | Rokas gets a "treneris atnaujino" notice; unchanged moves keep progress; the changed move starts fresh; no other student affected (Q29) |
| C-M2-2 | Check weak spots and activity on Friday evening on the phone | Gabija's 6.Be2 Taimanov (shared) and Dovydas's English Attack 19...Bb3 show as weak spots; streaks and last activity per student; Gabija's 9-day gap is visible |
| C-M2-3 | Set goals: habit goal for Rokas, mastery goal for Gabija (Slav by 2026-11-30) | Goals appear on the students' side and on his dashboard with progress (Q32) |
| C-M2-4 | Answer Rokas's question in a move comment thread; post a group message about Saturday | Thread and group message delivered; students get in-app notification and digest (Q33) |
| C-M2-5 | See that Dovydas forked "Naidorfo variantas" and shared the fork back | Dashboard shows the assignment as forked; he can view the shared fork; his own edits to the original no longer reach Dovydas |
| C-M2-6 | Review the draft 0-1400 starter repertoire as a trusted coach | He can comment on or approve it if the owner granted that role; otherwise he only sees the published version (Q36) |

### M3 Ecosystem

| ID | Journey | Expected outcome |
|---|---|---|
| C-M3-1 | Open the group's real-game deviation view after students linked Lichess/Chess.com | Per student: games, first deviation, own mistake vs opponent deviation; Rokas's 4.d4 mistake and Gabija's 9...Bd6 mistake are flagged (Q4, Q30) |
| C-M3-2 | Link his FIDE ID | FM and FIDE Trainer badges shown on his coach profile (Q34) |
| C-M3-3 | View students' FIDE ratings and Lithuania ranks on the group page | Ratings from staging fixtures: Gabija FIDE 1720, Dovydas FIDE 2185, each with their Lithuania rank (FIDE-LTU ranking); Rokas "unrated" for FIDE, Lichess rapid 1290 |
| C-M3-4 | Set a results goal for Gabija: no deviations in the next 5 games | Goal tracks imported games and updates on the dashboard (Q32) |
| C-M3-5 | Find the group's last club tournament (chess-results.com fixture) | Tournament with the three students' results; importable games feed the deviation view |
| C-M3-6 | Gabija unlinks from him | Access ends immediately: her shared Taimanov and games disappear from his dashboard; she keeps her progress and is offered forks of his assignments (Q26, Q41) |

## Seed data

| Item | Value |
|---|---|
| Account | `persona-coach@mychess.test`, display name "Rimantas Vaitkus", locale `lt`, coach capability on |
| Group | "Šeštadienio grupė" with Rokas (since 2026-04-12), Gabija (since 2026-02-01), Dovydas (since 2025-11-20); a pending invite link for a fourth, unseeded member |
| Second coach | `persona-coach2@mychess.test`, "Aistė Markevičienė", coach capability on, linked to Gabija only, no assignments (tests "player with several coaches", Q2) |
| Repertoires | All library repertoires in the table above, owned by this account, with Lithuanian per-move notes on at least 5 moves each |
| Assignments | As in the table; group assignment "Karo-Kan gynyba: pagrindai" with deadline 2026-12-20 |
| Own training | A small personal White repertoire (the Catalan main line from [2000plus.md](2000plus.md), first 12 moves) with a few weeks of reviews, to confirm the coach area and player area stay separate |
| Goals (M2) | Habit goal for Rokas, mastery goal for Gabija |
| Messages (M2) | Group thread with 3 messages; 1:1 thread with Gabija; move comment thread with Rokas on 4.c3 and with Dovydas on 16.Nbd4 |
| Linked accounts (M3) | FIDE placeholder ID with titles FM and FIDE Trainer; all served by staging fixtures |
