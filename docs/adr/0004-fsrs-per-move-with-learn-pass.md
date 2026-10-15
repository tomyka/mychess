# FSRS scheduling per repertoire Move, after a Learn pass

Status: accepted (2026-10-16, #226 Q6, Q15, Q30; owner-rulings R-22, R-24)

Each own-side Move a Player trains gets its own FSRS schedule (ts-fsrs): one Review per Player and Repertoire Move. A Move enters Review only after a Learn pass (arrows, then a blind retest, kept from v1). Free play against the Repertoire is a second mode. From M3, a Player mistake in a real game is recorded as a Lapse, making the Move Due now.

## Consequences

- The v1 mastery model (learn units, bands, practice pool, solved/learned) is retired, along with its depth gating.
- Training state is per Move, so every Repertoire change needs Reconciliation (ADR 0005).
- "Mastered Line/Chapter" (for Mastery goals and progress) is derived from per-Move Review state; the definition is still open (owner-rulings Open question 10).

## Considered options

- Keep v1's learn units + bands + weakest-first practice pool (v1 had abandoned FSRS for it): rejected in favour of FSRS per Move, keeping only v1's learn pass and reconciliation ideas.
