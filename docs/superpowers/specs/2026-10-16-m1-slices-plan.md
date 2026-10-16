# M1 Core loop: slice plan

Issue #233. Rulings: `docs/owner-rulings.md` (R-1 to R-75). Personas:
`docs/personas/`. Approved by the owner on 2026-10-16 (approach A: one spec
and plan per slice, written just before the slice is built).

M1 delivers the core loop of R-5: a coach invites players and assigns
repertoires; players learn and review them by FSRS; the coach sees basic
progress. Real testers start after M1 (R-5).

## Slices

Each slice is vertical (chess, domain, db, web, tests) and goes through
spec -> plan -> agent team -> review -> commit -> close, as in
`docs/agent-team.md`. "Done means" is the acceptance bar for the slice's
spec; the spec may sharpen it but not drop items.

| Slice | Scope | Rulings | Needs | Done means |
| --- | --- | --- | --- | --- |
| S1 Accounts | Better Auth (ADR 0010) sign-in by email magic link (Resend; Mailpit locally), Google, Lichess (also links the account); one account per canonical email; Display name and locale (LT default); free entitlement limits; Admin flag set by script; staging-only test sign-in for `@mychess.test`; account hard delete and data export | R-1, R-3, R-26, R-27, R-40, R-68, R-69, R-70, R-72, R-73; security checklist items 6-10 (#233) | infra #234 for staging only | A persona signs in each way locally and on staging; case and Unicode email variants never create a second account; production refuses test sign-in (test); delete removes every row of the account |
| S2 Chess core | Repertoire graph model; PGN parser updated to R-63 to R-66 (skip bad games with a report, arrows and circles, chapter intro, limits); ECO data and the šachmatai.lt taxonomy ported with LT names (chapter naming); FSRS wrapper over `ts-fsrs`; mastery and weak-spot maths; reconciliation of review state after repertoire edits | R-19, R-22, R-23, R-29, R-53, R-55, R-56, R-63 to R-66, R-74 | nothing | All of it pure and tested in `packages/chess`; mutation score above threshold; persona repertoires import cleanly |
| S3 Repertoires | Persist repertoires, chapters, moves, arrows, personal and coach notes; PGN import flow with the skipped-games report; board (chessground) browsing; board builder (add and remove moves, notes, arrows); sharing with chosen coaches | R-4, R-19, R-21, R-42, R-63 to R-66 | S1, S2 | Each persona's repertoires can be imported or built on a phone and a desktop, in LT and EN |
| S4 Coaching links | Coach capability switch; invites (unguessable, single use, expiring, revocable); coach links; groups; unlink with fork offer; the `canCoachSee` access rule used by every coach query | R-11 to R-13, R-39, R-44, R-45, R-47, R-50; security checklist 1-5 | S1 | The coach persona invites three players into "Šeštadienio grupė"; every coach route refuses an unlinked coach (tests); security-reviewer signs off |
| S5 Assignments | Assign to a player or a group (inherited by future members); live link; fork (progress carries); pause; deadlines with an overdue flag; coach edits reconciled into each player's learn queue with an "updated" flag | R-15, R-16, R-20, R-23, R-43, R-46, R-49, R-51, R-52 (flag only) | S3, S4 | Coach persona journeys C-M1-* pass; a coach edit reaches players with progress kept on unchanged moves |
| S6 Training | Learn pass (arrows, one blind retest); "I know this"; FSRS review with lapse replay, hint as lapse, session of 20 with continue, 10 new moves a day; two answers trained in context; offline result queue with retry banner | R-22, R-54, R-55, R-58 to R-62 | S3 (own repertoires), S5 (assigned) | Player persona journeys U1-M1-*, G-M1-*, D-M1-* pass; a dropped connection loses no result |
| S7 Coach progress | Per player and assignment: learned, due, mastered, overdue, paused, skipped moves; group overview | R-14, R-56 | S5, S6 | The coach persona sees each player's state matching the seeded history |
| S8 M1 exit | Persona seeds on staging; persona tester agents run the M1 journeys; `improve-codebase-architecture` over M1; v1 user count for R-71; owner promotes to production | R-32, R-71 | all | Tester findings triaged into issues; owner promotion |

Order: S1 and S2 in parallel; then S3 and S4 in parallel; then S5, S6, S7,
S8. S6 can start on own repertoires as soon as S3 lands.

## Deferred to M2 (already ruled)

Notification delivery and the daily digest (R-51 and R-52 notices; M1 shows
flags only), goals (R-17), threads and move comments (R-18), the weak-spot
dashboard (R-14), the explorer panel and starter repertoires (R-4, R-8),
and free play (R-22).

## Cross-cutting rules for every slice

- Visible text goes through the catalogues; i18n-content reviews it (R-74
  terms).
- Every screen is checked at 390px and 1280px, light and dark, by
  ux-designer against `docs/design/`.
- Every coach-facing query goes through `canCoachSee` once S4 exists.
- The persona journeys for the slice become E2E tests (qa, after #249).
